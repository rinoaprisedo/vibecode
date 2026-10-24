import { join } from "node:path";
import { homedir } from "node:os";
import { stat, rm, readdir, readFile, mkdir } from "node:fs/promises";

const LOCKED = /index\.lock|Unable to create '.*\.lock'|another git process/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ssh must never wait for a person: no password / host-key questions (there is no terminal), and give up on a dead network.
// New hosts are remembered on first use; a changed host key is still refused.
const SSH_CMD = process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new";

type Remote = { name: string; url: string; kind: "https" | "ssh" | "other"; host: string };
const parseRemote = (name: string, url: string): Remote => {
  const https = url.match(/^https?:\/\/(?:[^@/]+@)?([^/:]+)/i);
  const ssh = url.match(/^(?:ssh:\/\/)?(?:[\w.\-]+@)?([\w.\-]+)[:/]/);
  return https ? { name, url, kind: "https", host: https[1] } : ssh && !/^[a-z]:\\/i.test(url) && !url.startsWith("/") && !url.startsWith(".") ? { name, url, kind: "ssh", host: ssh[1] } : { name, url, kind: "other", host: "" };
};

const sh = async (cmd: string[], stdin?: string) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: stdin === undefined ? "ignore" : new Blob([stdin]), env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};
const SSH_DIR = join(homedir(), ".ssh");

// Where git keeps a saved token on this system, for the sign-in help.
export const credentialStore = () =>
  process.platform === "darwin" ? { helper: "osxkeychain", where: "the macOS Keychain" }
  : process.platform === "win32" ? { helper: "manager", where: "the Windows Credential Manager" }
  : { helper: "store", where: "~/.git-credentials (plain text)" };

// Saves a login for one https host using git's own credential helper (the Keychain on a Mac), so push and pull just work after.
export async function saveCredential(host: string, username: string, token: string) {
  if (!/^[\w.\-]+(:\d+)?$/.test(host)) throw new Error("Unusual host name");
  if (!username.trim() || !token.trim() || /[\r\n]/.test(username + token)) throw new Error("Enter your username and token");
  const store = credentialStore();
  const cur = (await sh(["git", "config", "--global", "--get", "credential.helper"])).out.trim();
  if (!cur) {
    const set = await sh(["git", "config", "--global", "credential.helper", store.helper]);
    if (set.code !== 0) throw new Error(set.err.trim() || "Could not set up the credential helper");
  }
  const r = await sh(["git", "credential", "approve"], `protocol=https\nhost=${host}\nusername=${username.trim()}\npassword=${token.trim()}\n\n`);
  if (r.code !== 0) throw new Error(r.err.trim() || "Git could not save the login");
  return store.where;
}

const KEY_ORDER = ["id_ed25519", "id_ecdsa", "id_rsa"];
export async function sshKey(): Promise<{ has: boolean; name: string; publicKey: string }> {
  const names = (await readdir(SSH_DIR).catch(() => [] as string[])).filter((n) => n.endsWith(".pub")).map((n) => n.slice(0, -4));
  names.sort((a, b) => (KEY_ORDER.indexOf(a) + 1 || 99) - (KEY_ORDER.indexOf(b) + 1 || 99));
  for (const n of names) {
    const pub = (await readFile(join(SSH_DIR, n + ".pub"), "utf8").catch(() => "")).trim();
    if (pub) return { has: true, name: n + ".pub", publicKey: pub };
  }
  return { has: false, name: "", publicKey: "" };
}
// Never overwrites an existing key: it only makes ~/.ssh/id_ed25519 when that file is absent.
export async function makeSshKey(comment: string) {
  const file = join(SSH_DIR, "id_ed25519");
  if (await stat(file).then(() => true, () => false)) throw new Error("~/.ssh/id_ed25519 already exists, so it was left alone");
  await mkdir(SSH_DIR, { recursive: true, mode: 0o700 });
  const r = await sh(["ssh-keygen", "-t", "ed25519", "-C", comment.replace(/[^\w@.\- ]/g, "").trim() || "vibecode", "-f", file, "-N", ""]);
  if (r.code !== 0) throw new Error(r.err.trim() || "ssh-keygen failed");
  return sshKey();
}

export const makeGit = (root: string) => {
  // One git command at a time per repo: parallel ones (a refresh while staging, say) fight over .git/index.lock.
  let chain: Promise<unknown> = Promise.resolve();

  const exec = async (args: string[], readOnly: boolean) => {
    for (let attempt = 0; ; attempt++) {
      const proc = Bun.spawn(["git", ...args], {
        cwd: root, stdout: "pipe", stderr: "pipe",
        // No credential prompts (no terminal); read-only commands must not take the index lock at all.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: SSH_CMD, ...(readOnly ? { GIT_OPTIONAL_LOCKS: "0" } : {}) },
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ]);
      if (code === 0) return out;
      if (LOCKED.test(err) && attempt < 4) { await sleep(250 * (attempt + 1)); continue; } // something else is using the repo briefly
      throw new Error(err.trim() || `git ${args[0]} failed`);
    }
  };
  const git = (args: string[], readOnly = false): Promise<string> => {
    const run = chain.then(() => exec(args, readOnly));
    chain = run.catch(() => {});
    return run;
  };

  return {
    async status() {
      const out = await git(["status", "--porcelain=v1", "-b", "--ignored=matching"], true);
      const lines = out.split("\n").filter(Boolean);
      const branch = lines[0]?.startsWith("##") ? lines.shift()!.slice(3) : "";
      const all = lines.map((l) => ({ x: l[0], y: l[1], path: l.slice(3) }));
      // "!!" entries are gitignored paths: not changes, but the explorer greys them out like untracked ones.
      const ahead = Number(/\[ahead (\d+)/.exec(branch)?.[1] ?? 0); // commits not pushed yet
      return { branch, ahead, files: all.filter((f) => f.x !== "!"), ignored: all.filter((f) => f.x === "!").map((f) => f.path) };
    },
    diff: (path: string, staged: boolean) => git(["diff", ...(staged ? ["--cached"] : []), "--", path], true),
    stage: (path: string) => git(["add", "--", path]),
    // `restore --staged` needs a HEAD; in a repo with no commits yet, drop the file from the index instead.
    unstage: (path: string) =>
      git(["restore", "--staged", "--", path]).catch((e) =>
        /could not resolve HEAD/i.test(String(e.message)) ? git(["rm", "--cached", "-r", "--ignore-unmatch", "-q", "--", path]) : Promise.reject(e)),
    // Commit everything: stage all changes (including new files) first, then commit.
    async commit(message: string, all = true) {
      if (all) await git(["add", "-A"]);
      return git(["commit", "-m", message]);
    },
    // First push of a branch sets its upstream on origin.
    async push() {
      const hasUpstream = await git(["rev-parse", "--abbrev-ref", "@{u}"], true).then(() => true, () => false);
      return git(hasUpstream ? ["push"] : ["push", "-u", "origin", "HEAD"]);
    },
    // Fast-forward only: never creates a merge commit or rewrites local work behind your back.
    pull: () => git(["pull", "--ff-only"]),
    // Recent commits of the current branch, each flagged as pushed or not (compared with its upstream).
    async log(limit = 60) {
      const sep = "\x1f";
      const out = await git(["log", `-n${limit}`, `--format=%H${sep}%h${sep}%an${sep}%at${sep}%s${sep}%D`], true).catch(() => "");
      const upstream = await git(["rev-parse", "--abbrev-ref", "@{u}"], true).then((x) => x.trim(), () => "");
      // Commits not on the upstream (or, with no upstream yet, not on any remote branch). Counted over the whole history, not just the listed page.
      const range = upstream ? [`${upstream}..HEAD`] : ["HEAD", "--not", "--remotes"];
      const all = (await git(["rev-list", ...range], true).catch(() => "")).split("\n").filter(Boolean);
      const local = new Set(all);
      const commits = out.split("\n").filter(Boolean).map((l) => {
        const [hash, short, author, at, subject, refs] = l.split(sep);
        return { hash, short, author, at: Number(at) * 1000, subject, refs: refs ? refs.split(", ").filter(Boolean) : [], pushed: !local.has(hash) };
      });
      return { upstream, ahead: all.length, commits };
    },
    // Message body and changed files of one commit.
    async show(hash: string) {
      if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error("bad commit id");
      const body = await git(["show", "-s", "--format=%b", hash], true);
      const files = await git(["show", "--name-status", "--format=", hash], true);
      return { body: body.trim(), files: files.split("\n").filter(Boolean).map((l) => { const [code, ...rest] = l.split("\t"); return { code: code[0], path: rest.join(" → ") }; }) };
    },
    async branches() {
      const out = await git(["branch", "-a", "--format=%(HEAD)|%(refname:short)"], true);
      const rows = out.split("\n").filter(Boolean).map((l) => ({ current: l[0] === "*", name: l.slice(2) }));
      const names = new Set(rows.map((r) => r.name).filter((n) => !n.endsWith("/HEAD") && !n.startsWith("(")));
      // Hide "origin/x" when a local "x" exists; keep remote-only branches.
      const branches = [...names].filter((n) => !(n.startsWith("origin/") && names.has(n.slice(7)))).sort();
      return { current: rows.find((r) => r.current)?.name ?? "", branches };
    },
    checkout: (name: string) => git(["checkout", name.replace(/^origin\//, "")]),
    createBranch: (name: string, from?: string) => git(["checkout", "-b", name, ...(from ? [from] : [])]),
    init: () => git(["init"]),
    // Who commits will be, where this repo pushes, and what sign-in applies: input for the "fix it" help in the Git panel.
    async identity() {
      const get = (k: string) => git(["config", "--get", k], true).then((v) => v.trim(), () => "");
      const [name, email, helper, remotes] = await Promise.all([
        get("user.name"), get("user.email"), get("credential.helper"), git(["remote", "-v"], true).catch(() => ""),
      ]);
      const list = remotes.split("\n").filter((l) => l.endsWith("(push)")).map((l) => { const [n, u] = l.split(/\s+/); return parseRemote(n, u); });
      const remote = list.find((r) => r.name === "origin") ?? list[0] ?? null;
      return { name, email, helper, remote, storage: credentialStore().where, platform: process.platform };
    },
    async setIdentity(name: string, email: string, global: boolean) {
      if (!name.trim() || !/^\S+@\S+$/.test(email.trim())) throw new Error("Enter your name and a valid email");
      const scope = global ? ["--global"] : [];
      await git(["config", ...scope, "user.name", name.trim()]);
      await git(["config", ...scope, "user.email", email.trim()]);
    },
    async setRemote(url: string) {
      const u = url.trim();
      if (!u || /\s/.test(u) || u.startsWith("-")) throw new Error("Paste the repository URL, like https://github.com/you/project.git");
      const has = await git(["remote", "get-url", "origin"], true).then(() => true, () => false);
      return git(has ? ["remote", "set-url", "origin", u] : ["remote", "add", "origin", u]);
    },
    // Read-only check that the saved sign-in or key really reaches the remote.
    testRemote: () => git(["ls-remote", "--heads", "origin"], true),
    // A crashed git can leave .git/index.lock behind. Only removed when it is clearly stale (older than 10s).
    async removeStaleLock() {
      const lock = join(root, ".git", "index.lock");
      const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => -1);
      if (age < 0) return "no lock";
      if (age < 10_000) throw new Error("A git command is still running here; try again in a moment.");
      await rm(lock, { force: true });
      return "removed";
    },
  };
};
