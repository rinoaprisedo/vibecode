import { join } from "node:path";
import { stat, rm } from "node:fs/promises";

const LOCKED = /index\.lock|Unable to create '.*\.lock'|another git process/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const makeGit = (root: string) => {
  // One git command at a time per repo: parallel ones (a refresh while staging, say) fight over .git/index.lock.
  let chain: Promise<unknown> = Promise.resolve();

  const exec = async (args: string[], readOnly: boolean) => {
    for (let attempt = 0; ; attempt++) {
      const proc = Bun.spawn(["git", ...args], {
        cwd: root, stdout: "pipe", stderr: "pipe",
        // No credential prompts (no terminal); read-only commands must not take the index lock at all.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(readOnly ? { GIT_OPTIONAL_LOCKS: "0" } : {}) },
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
      return { branch, files: all.filter((f) => f.x !== "!"), ignored: all.filter((f) => f.x === "!").map((f) => f.path) };
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
