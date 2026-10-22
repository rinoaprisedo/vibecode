import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { makeAgent } from "./agent";
import { authStatus, makeLogin } from "./auth";
import { makeTerminals } from "./terminal";
import { getUsage } from "./usage";
import { getModels } from "./models";
import { makeProjects } from "./projects";
import { accounts, findDuplicate } from "./accounts";
import { makeRemote, trustFolder } from "./remote";
import { images } from "./images";
import { WEB_DIR } from "./paths";
import { pasteInto } from "./fs";
import { relative } from "node:path";

const token = crypto.randomUUID();
const webDir = WEB_DIR;

type Data = { agent?: ReturnType<typeof makeAgent>; login?: ReturnType<typeof makeLogin>; term?: ReturnType<typeof makeTerminals> };
type WS = import("bun").ServerWebSocket<Data>;
const sockets = new Set<WS>();
const broadcast = (m: unknown) => { const t = JSON.stringify(m); for (const s of sockets) s.send(t); };

// Folders open at the same time; each has its own files, git, chats and watcher.
const projects = makeProjects((project, path) => broadcast({ type: "fs-changed", project, path }));
await projects.load();
// From a terminal, `bun server/index.ts [folder]` opens that folder (or the current one). The packaged app
// never adds one by itself: it only reopens the folders you added.
if (!process.env.VIBECODE_APP) await projects.add(resolve(process.argv[2] ?? process.cwd())).catch(() => {});
const anyRoot = () => projects.first()?.root ?? homedir();

const remote = makeRemote(broadcast);
// On shutdown let Remote Control unregister cleanly before exiting.
let closing = false;
const shutdown = () => { if (closing) return; closing = true; void remote.stopAll().finally(() => process.exit(0)); };
// The packaged app's server must not outlive the window: if the launcher dies without cleaning up (crash, force quit),
// we get re-parented to launchd (ppid 1) and shut down on our own.
if (process.env.VIBECODE_APP) setInterval(() => { if (process.ppid === 1) shutdown(); }, 2000);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Native macOS folder picker (the server runs on the user's Mac).
async function pickFolder(): Promise<string | null> {
  const p = Bun.spawn(
    ["osascript", "-e", 'POSIX path of (choose folder with prompt "Open Folder")'],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = (await new Response(p.stdout).text()).trim();
  return (await p.exited) === 0 && out ? out : null; // non-zero = user cancelled
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

const start = (port: number) => Bun.serve<Data>({
  hostname: "127.0.0.1",
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/") return new Response(Bun.file(join(webDir, "index.html")));
    if (p === "/main.js") return new Response(Bun.file(join(webDir, "dist", "main.js")));
    if (p === "/loading.gif") return new Response(Bun.file(join(webDir, "loading.gif")));
    if (p === "/main.css") return new Response(Bun.file(join(webDir, "dist", "main.css")));

    if (url.searchParams.get("token") !== token && req.headers.get("x-token") !== token)
      return json({ error: "unauthorized" }, 401);
    if (p === "/ws") return srv.upgrade(req, { data: {} }) ? undefined : json({ error: "upgrade" }, 400);

    try {
      const q = url.searchParams;
      // Project-scoped routes name their folder with the x-project header (or ?project=).
      const proj = () => projects.get(req.headers.get("x-project") ?? q.get("project"));
      if (p === "/api/projects" && req.method === "GET")
        return json(projects.list().map(({ id, root, name }) => ({ id, root, name })));
      if (p === "/api/images" && req.method === "POST") {
        const mime = req.headers.get("content-type") ?? "";
        return json({ id: await images.save(mime, new Uint8Array(await req.arrayBuffer())) });
      }
      if (p.startsWith("/api/images/") && req.method === "GET") {
        const img = await images.read(p.slice("/api/images/".length));
        return new Response(new Uint8Array(img.data), { headers: { "content-type": img.mime, "cache-control": "private, max-age=31536000, immutable" } });
      }
      if (p === "/api/remote" && req.method === "GET") return json(remote.list());
      if (p === "/api/remote/start" && req.method === "POST") {
        const proj = projects.get(req.headers.get("x-project"));
        const { account } = await req.json().catch(() => ({}));
        return json(remote.start(proj.id, proj.root, proj.name, await accounts.get(account)));
      }
      if (p === "/api/remote/stop" && req.method === "POST") { remote.stop(projects.get(req.headers.get("x-project")).id); return json({ ok: true }); }
      if (p === "/api/remote/trust" && req.method === "POST") {
        const proj = projects.get(req.headers.get("x-project"));
        const { account, confirmed } = await req.json().catch(() => ({}));
        if (confirmed !== true) throw new Error("Trust must be confirmed by the user");
        await trustFolder(await accounts.get(account), proj.root);
        return json({ ok: true });
      }
      if (p === "/api/projects/recent") return json(projects.recent());
      if (p === "/api/projects" && req.method === "POST") {
        const { path } = await req.json().catch(() => ({}));
        const chosen = path || (await pickFolder());
        if (!chosen) return json({ cancelled: true });
        const { id, root, name } = await projects.add(chosen);
        broadcast({ type: "projects-changed" });
        return json({ id, root, name });
      }
      if (p.startsWith("/api/projects/") && req.method === "DELETE") {
        const gone = p.slice("/api/projects/".length);
        remote.stop(gone);              // its Remote Control goes with it; the folder itself is never touched
        await projects.remove(gone);
        broadcast({ type: "projects-changed" });
        return json({ ok: true });
      }
      // Claude accounts: each is its own login; a chat picks one.
      if (p === "/api/accounts" && req.method === "GET") {
        return json(await Promise.all((await accounts.list()).map(async (a) => ({ id: a.id, name: a.name, ...(await authStatus(a.dir)) }))));
      }
      if (p === "/api/accounts" && req.method === "POST") {
        const { name } = await req.json().catch(() => ({}));
        const a = await accounts.add(name ?? "");
        return json({ id: a.id, name: a.name, loggedIn: false, method: "none" });
      }
      if (p.startsWith("/api/accounts/")) {
        const [id, action] = p.slice("/api/accounts/".length).split("/");
        const a = await accounts.get(id);
        if (action === "logout" && req.method === "POST") { await makeLogin(() => {}).logout(a.dir); return json({ ok: true }); }
        if (!action && req.method === "PATCH") { await accounts.rename(id, (await req.json()).name); return json({ ok: true }); }
        if (!action && req.method === "DELETE") { await makeLogin(() => {}).logout(a.dir); await accounts.remove(id); return json({ ok: true }); }
      }
      if (p === "/api/models") return json(await getModels(anyRoot(), (await accounts.get(q.get("account") ?? "")).dir));
      if (p === "/api/usage") return json(await getUsage(anyRoot(), (await accounts.get(q.get("account") ?? "")).dir));
      if (p === "/api/chats" && req.method === "GET") return json(await proj().chats.list());
      if (p.startsWith("/api/chats/")) {
        const id = p.slice("/api/chats/".length);
        if (req.method === "GET") return json(await proj().chats.get(id));
        if (req.method === "PUT") { await proj().chats.save(id, await req.json()); return json({ ok: true }); }
        if (req.method === "DELETE") { await proj().chats.remove(id); return json({ ok: true }); }
      }
      if (p === "/api/files") return json(await proj().fs.files());
      if (p === "/api/fs/create" && req.method === "POST") { const b = await req.json(); await proj().fs.create(b.path, b.kind); return json({ ok: true }); }
      if (p === "/api/fs/rename" && req.method === "POST") { const b = await req.json(); await proj().fs.rename(b.from, b.to); return json({ ok: true }); }
      if (p === "/api/fs/delete" && req.method === "POST") { const b = await req.json(); await proj().fs.remove(b.path, b.permanent === true); return json({ ok: true }); }
      if (p === "/api/fs/paste" && req.method === "POST") {
        // items may come from any open project; the destination is the project in x-project
        const b = await req.json();
        const dest = proj();
        const destAbs = dest.fs.jail(b.dir ?? "");
        const sources = (b.items as { project: string; path: string }[]).map((it) => projects.get(it.project).fs.jail(it.path));
        const names = await pasteInto(sources, destAbs, b.move === true);
        return json({ created: names.map((n) => relative(dest.root, join(destAbs, n))) });
      }
      if (p === "/api/tree") return json(await proj().fs.tree(q.get("path") ?? ""));
      if (p === "/api/file" && req.method === "GET") return json({ content: await proj().fs.read(q.get("path")!) });
      if (p === "/api/file" && req.method === "PUT") {
        await proj().fs.write(q.get("path")!, (await req.json()).content);
        return json({ ok: true });
      }
      if (p === "/api/git/status") return json(await proj().git.status());
      if (p === "/api/git/diff") return json({ diff: await proj().git.diff(q.get("path")!, q.get("staged") === "1") });
      if (p === "/api/git/stage") return json({ out: await proj().git.stage((await req.json()).path) });
      if (p === "/api/git/unstage") return json({ out: await proj().git.unstage((await req.json()).path) });
      if (p === "/api/git/commit") return json({ out: await proj().git.commit((await req.json()).message) });
      if (p === "/api/git/push") return json({ out: await proj().git.push() });
      if (p === "/api/git/branches") return json(await proj().git.branches());
      if (p === "/api/git/checkout") return json({ out: await proj().git.checkout((await req.json()).name) });
      if (p === "/api/git/branch") {
        const { name, from } = await req.json();
        return json({ out: await proj().git.createBranch(name, from || undefined) });
      }
      if (p === "/api/git/unlock") return json({ out: await proj().git.removeStaleLock() });
      if (p === "/api/git/init") return json({ out: await proj().git.init() });
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 400);
    }
    return json({ error: "not found" }, 404);
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      const out = (m: unknown) => ws.send(JSON.stringify(m));
      ws.data.agent = makeAgent(out);
      // A finished sign-in is checked first: signing the same Anthropic account in twice is refused.
      ws.data.login = makeLogin((m: any) => {
        if (m.type !== "login-result" || !m.ok) return out(m);
        void (async () => {
          const dup = await findDuplicate(m.account, async (a) => authStatus(a.dir)).catch(() => null);
          if (!dup) return out(m);
          const me = await accounts.get(m.account);
          await makeLogin(() => {}).logout(me.dir);            // drop the credentials we just stored
          out({ ...m, ok: false, duplicateOf: dup.name, email: dup.email, status: await authStatus(me.dir) });
        })();
      });
      ws.data.term = makeTerminals(out);
    },
    close(ws) {
      ws.data.agent?.stopAll();
      ws.data.login?.stop();
      ws.data.term?.closeAll();
      sockets.delete(ws);
    },
    message(ws, raw) {
      const m = JSON.parse(String(raw));
      if (m.type === "prompt") void ws.data.agent!.run(m.chatId, projects.get(m.project).root, m.text, m.opts, m.images);
      else if (m.type === "permission") ws.data.agent!.answerPermission(m.id, m.allow);
      else if (m.type === "login-start") void accounts.get(m.account).then((a) => ws.data.login!.start(m.mode, a.id, a.dir));
      else if (m.type === "login-code") ws.data.login!.submitCode(m.code);
      else if (m.type === "login-cancel") ws.data.login!.stop();
      else if (m.type === "term-open") ws.data.term!.open(m.id, projects.get(m.project).root, m.cols, m.rows);
      else if (m.type === "term-input") ws.data.term!.input(m.id, m.data);
      else if (m.type === "term-resize") ws.data.term!.resize(m.id, m.cols, m.rows);
      else if (m.type === "term-close") ws.data.term!.close(m.id);
      else if (m.type === "stop") ws.data.agent!.stop(m.chatId);
    },
  },
});

// A preferred port keeps the web view's origin stable; if it is taken, let the OS pick one.
let server: ReturnType<typeof start>;
try { server = start(Number(process.env.PORT ?? 4747)); } catch { server = start(0); }

const url = `http://127.0.0.1:${server.port}/?token=${token}`;
console.log(`vibecode: ${projects.list().map((p) => p.root).join(", ")}\n${url}`);
if (process.env.NO_OPEN !== "1") Bun.spawn(["open", url]);
