import { isWin, isMac, pickFolderNative, findAppBrowser, openUrl } from "./platform";
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
import { templates } from "./templates";
import { makeTunnels } from "./tunnel";
import { saveCredential, sshKey, makeSshKey } from "./git";
import { dockerApi, makeDockerLogs } from "./docker";
import { pgApi } from "./postgres";
import { WEB_DIR, DATA_DIR, PACKAGED } from "./paths";
import { BOILERPLATES, checkTarget, defaultParent, makeBoilerplate } from "./boilerplate";
import { pasteInto } from "./fs";
import { relative } from "node:path";

const token = crypto.randomUUID();
const webDir = WEB_DIR;

type Data = { agent?: ReturnType<typeof makeAgent>; login?: ReturnType<typeof makeLogin>; term?: ReturnType<typeof makeTerminals>; dockerLogs?: ReturnType<typeof makeDockerLogs> };
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
// Create from boilerplate: progress goes to every window as {type:"boilerplate", job, ...}. When it finishes
// the new folder is opened like any other project.
const boilerplate = makeBoilerplate((job, p) => {
  if (p.phase !== "done") { broadcast({ type: "boilerplate", job, ...p }); return; }
  projects.add(p.root).then(({ id, root, name }) => {
    broadcast({ type: "projects-changed" });
    broadcast({ type: "boilerplate", job, phase: "done", id, root, name });
  }).catch((e) => broadcast({ type: "boilerplate", job, phase: "error", message: String(e.message ?? e) }));
});
const tunnels = makeTunnels(broadcast, () => server?.port);
// On shutdown let Remote Control unregister cleanly before exiting.
let closing = false;
const shutdown = () => { if (closing) return; closing = true; tunnels.stopAll(); void remote.stopAll().finally(() => process.exit(0)); };
// The packaged app's server must not outlive the window: if the launcher dies without cleaning up (crash, force quit),
// we get re-parented to launchd (ppid 1) and shut down on our own.
if (process.env.VIBECODE_APP && process.platform !== "win32") setInterval(() => { if (process.ppid === 1) shutdown(); }, 2000);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Native macOS folder picker (the server runs on the user's Mac).
async function pickFolder(prompt = "Open Folder"): Promise<string | null> {
  if (!isMac) return pickFolderNative(prompt);
  const p = Bun.spawn(
    ["osascript", "-e", "on run argv", "-e", "POSIX path of (choose folder with prompt (item 1 of argv))", "-e", "end run", prompt],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = (await new Response(p.stdout).text()).trim();
  return (await p.exited) === 0 && out ? out : null; // non-zero = user cancelled
}

let idleExit = false, idleTimer: ReturnType<typeof setTimeout> | undefined;
const json = (data: unknown, status = 200) => Response.json(data, { status });

const start = (port: number) => Bun.serve<Data>({
  hostname: "127.0.0.1",
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/") return new Response(Bun.file(join(webDir, "index.html")), { headers: { "Cache-Control": "no-cache" } });
    if (p === "/main.js") return new Response(Bun.file(join(webDir, "dist", "main.js")), { headers: { "Cache-Control": "no-cache" } });
    if (p === "/loading.gif") return new Response(Bun.file(join(webDir, "loading.gif")));
    if (p === "/main.css") return new Response(Bun.file(join(webDir, "dist", "main.css")), { headers: { "Cache-Control": "no-cache" } });

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
        const { account, mode } = await req.json().catch(() => ({}));
        return json(remote.start(proj.id, proj.root, proj.name, await accounts.get(account), mode));
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
      if (p === "/api/boilerplate" && req.method === "GET")
        return json({ items: BOILERPLATES, defaultParent: await defaultParent(projects.first() ? resolve(projects.first()!.root, "..") : undefined) });
      if (p === "/api/boilerplate/pick" && req.method === "POST") {
        const dir = await pickFolder("Choose where to create the project");
        return json(dir ? { path: dir.replace(/\/$/, "") } : { cancelled: true });
      }
      if (p === "/api/boilerplate/check") return json(await checkTarget(q.get("parent") ?? "", q.get("name") ?? ""));
      if (p === "/api/boilerplate/create" && req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        const job = crypto.randomUUID();
        try { await boilerplate.start(job, String(b.id), String(b.parent), String(b.name), b.fresh !== false); }
        catch (e: any) { return json({ error: e.message }, 400); }
        return json({ job });
      }
      if (p === "/api/boilerplate/cancel" && req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        boilerplate.cancel(String(b.job));
        return json({ ok: true });
      }
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
        tunnels.stopProject(gone);
        remote.stop(gone);              // its Remote Control goes with it; the folder itself is never touched
        await projects.remove(gone);
        broadcast({ type: "projects-changed" });
        return json({ ok: true });
      }
      // Claude accounts: each is its own login; a chat picks one.
      if (p === "/api/accounts" && req.method === "GET") {
        return json(await Promise.all((await accounts.list()).map(async (a) => ({ id: a.id, name: a.name, color: a.color, ...(await authStatus(a.dir)) }))));
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
        if (!action && req.method === "PATCH") { const b = await req.json(); if (b.name) await accounts.rename(id, b.name); if (b.color) await accounts.setColor(id, b.color); return json({ ok: true }); }
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
      if (p.startsWith("/api/tunnel/")) {
        const act = p.slice("/api/tunnel/".length);
        if (act === "status") return json(await tunnels.status());
        if (act === "ports") return json(await tunnels.ports(projects.get(req.headers.get("x-project") ?? q.get("project")).root));
        if (act === "install" && req.method === "POST") { await tunnels.install(); return json(await tunnels.status()); }
        if (act === "start" && req.method === "POST") { const b = await req.json().catch(() => ({})); return json(tunnels.start(projects.get(req.headers.get("x-project")).id, Number(b.port))); }
        if (act === "stop" && req.method === "POST") { const b = await req.json().catch(() => ({})); tunnels.stop(projects.get(req.headers.get("x-project")).id, Number(b.port)); return json({ ok: true }); }
      }
      if (p === "/api/templates" && req.method === "GET") return json(await templates.load());
      if (p === "/api/templates" && req.method === "PUT") return json(await templates.save(await req.json()));
      if (p.startsWith("/api/pg/")) return json(await pgApi(p.slice("/api/pg/".length), req.method, await req.json().catch(() => ({}))));
      if (p.startsWith("/api/docker/")) {
        const root = (() => { try { return projects.get(req.headers.get("x-project") ?? q.get("project")).root; } catch { return anyRoot(); } })();
        return json(await dockerApi(p.slice("/api/docker/".length), req.method, q, () => req.json().catch(() => ({})), root));
      }
      if (p === "/api/git/status") return json(await proj().git.status());
      if (p === "/api/git/diff") return json({ diff: await proj().git.diff(q.get("path")!, q.get("staged") === "1") });
      if (p === "/api/git/stage") return json({ out: await proj().git.stage((await req.json()).path) });
      if (p === "/api/git/unstage") return json({ out: await proj().git.unstage((await req.json()).path) });
      if (p === "/api/git/commit") return json({ out: await proj().git.commit((await req.json()).message) });
      if (p === "/api/git/push") return json({ out: await proj().git.push() });
      if (p === "/api/git/log") return json(await proj().git.log());
      if (p === "/api/git/show") return json(await proj().git.show(q.get("hash") ?? ""));
      if (p === "/api/git/pull") return json({ out: await proj().git.pull() });
      if (p === "/api/git/branches") return json(await proj().git.branches());
      if (p === "/api/git/checkout") return json({ out: await proj().git.checkout((await req.json()).name) });
      if (p === "/api/git/branch") {
        const { name, from } = await req.json();
        return json({ out: await proj().git.createBranch(name, from || undefined) });
      }
      if (p === "/api/git/identity" && req.method === "GET") return json({ ...(await proj().git.identity()), ssh: await sshKey() });
      if (p === "/api/git/identity" && req.method === "POST") { const b = await req.json(); await proj().git.setIdentity(String(b.name ?? ""), String(b.email ?? ""), b.global !== false); return json({ ok: true }); }
      if (p === "/api/git/credentials" && req.method === "POST") {
        const b = await req.json();
        const remote = (await proj().git.identity()).remote;
        if (remote?.kind !== "https") throw new Error("This repository does not use an https address");
        return json({ where: await saveCredential(remote.host, String(b.username ?? ""), String(b.token ?? "")) });
      }
      if (p === "/api/git/ssh-key" && req.method === "POST") return json(await makeSshKey((await proj().git.identity()).email));
      if (p === "/api/git/remote" && req.method === "POST") return json({ out: await proj().git.setRemote(String((await req.json()).url ?? "")) });
      if (p === "/api/git/test" && req.method === "POST") { await proj().git.testRemote(); return json({ ok: true }); }
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
      clearTimeout(idleTimer);
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
      ws.data.dockerLogs = makeDockerLogs(out);
    },
    close(ws) {
      if (idleExit && sockets.size <= 1) idleTimer = setTimeout(() => { if (sockets.size === 0) shutdown(); }, 20_000);
      ws.data.agent?.stopAll();
      ws.data.login?.stop();
      ws.data.term?.closeAll();
      ws.data.dockerLogs?.closeAll();
      sockets.delete(ws);
    },
    message(ws, raw) {
      const m = JSON.parse(String(raw));
      if (m.type === "prompt") void ws.data.agent!.run(m.chatId, projects.get(m.project).root, m.text, m.opts, m.images);
      else if (m.type === "permission") ws.data.agent!.answerPermission(m.id, m.allow, m.answers, typeof m.message === "string" ? m.message : undefined, m.mode);
      else if (m.type === "login-start") void accounts.get(m.account).then((a) => ws.data.login!.start(m.mode, a.id, a.dir));
      else if (m.type === "login-code") ws.data.login!.submitCode(m.code);
      else if (m.type === "login-cancel") ws.data.login!.stop();
      else if (m.type === "term-open") ws.data.term!.open(m.id, projects.get(m.project).root, m.cols, m.rows, m.docker);
      else if (m.type === "docker-logs-open") ws.data.dockerLogs!.open(m.id, m.container, m.tail);
      else if (m.type === "docker-logs-close") ws.data.dockerLogs!.close(m.id);
      else if (m.type === "term-input") ws.data.term!.input(m.id, m.data);
      else if (m.type === "term-resize") ws.data.term!.resize(m.id, m.cols, m.rows);
      else if (m.type === "term-close") ws.data.term!.close(m.id);
      else if (m.type === "stop") ws.data.agent!.stop(m.chatId);
    },
  },
});

// A preferred port keeps the web view's origin stable; if it is taken, let the OS pick one.
let server: ReturnType<typeof start>;
try { server = start(Number(process.env.PORT ?? (isWin || PACKAGED ? 47474 : 4747))); } catch { server = start(0); }

const url = `http://127.0.0.1:${server.port}/?token=${token}`;
console.log(`vibecode: ${projects.list().map((p) => p.root).join(", ")}\n${url}`);
// Windows (always) and the packaged Linux build: show the UI in its own chrome-less app window (Edge ships with Windows; on
// Linux any Chromium-based browser) with a private profile, so the window and its saved settings belong to Vibecoder.
// Closing the window stops the server. Without such a browser the UI opens in the default one and the server exits a
// little after the last tab is closed (packaged builds only), so it never lingers in the background.
const appBrowser = !isMac && (isWin || PACKAGED) && !process.env.VIBECODE_NO_WINDOW ? findAppBrowser() : null;
if (appBrowser && process.env.NO_OPEN !== "1") {
  const profile = join(DATA_DIR, "window");
  const started = Date.now();
  const win = Bun.spawn([appBrowser, `--app=${url}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1440,900", "--ozone-platform-hint=auto"], { stdio: ["ignore", "ignore", "ignore"] });
  void win.exited.then(() => { if (Date.now() - started > 3000) shutdown(); });
} else {
  if (process.env.NO_OPEN !== "1") openUrl(url);
  if (!isMac && PACKAGED) idleExit = true;
}
