import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdir, rm, stat, readdir } from "node:fs/promises";

export type Boilerplate = { id: string; name: string; description: string; repo: string; tags: string[] };

// Starter projects offered in "Create project → From boilerplate".
export const BOILERPLATES: Boilerplate[] = [
  {
    id: "basego",
    name: "Basego",
    description: "Go backend and web frontend starter with Docker, ready to run.",
    repo: "https://github.com/rinoaprisedo/basego.git",
    tags: ["Go", "Docker", "Frontend"],
  },
];

const expand = (p: string) => resolve(p.replace(/^~(?=$|[\/\\])/, homedir()));
const exists = (p: string) => stat(p).then(() => true, () => false);
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export type Check = { ok: boolean; target: string; error?: string };

// Can a project called `name` be created inside `parent`?
export async function checkTarget(parent: string, name: string): Promise<Check> {
  const base = expand(parent || homedir());
  const target = join(base, name);
  if (!name) return { ok: false, target: base, error: "Give the project a name." };
  if (!NAME_OK.test(name)) return { ok: false, target, error: "Use letters, numbers, dot, dash or underscore (no spaces or slashes)." };
  const s = await stat(base).catch(() => null);
  if (!s) return { ok: false, target, error: "That location does not exist." };
  if (!s.isDirectory()) return { ok: false, target, error: "That location is not a folder." };
  if (await exists(target)) {
    const empty = (await readdir(target).catch(() => ["x"])).length === 0;
    if (!empty) return { ok: false, target, error: `A folder named “${name}” already exists there.` };
  }
  return { ok: true, target };
}

export type Progress =
  | { phase: "clone"; percent: number; label: string }
  | { phase: "git"; label: string }
  | { phase: "done"; root: string }
  | { phase: "error"; message: string }
  | { phase: "cancelled" };

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

// Clones a boilerplate into parent/name and reports progress. With `fresh`, the template's history is dropped
// and a new repository with one commit is created, so the new project is never tied to the template's remote.
export function makeBoilerplate(emit: (job: string, p: Progress) => void) {
  const jobs = new Map<string, { proc?: ReturnType<typeof Bun.spawn>; cancelled: boolean; target: string; created: boolean }>();

  const run = async (cwd: string, args: string[]) => {
    const p = Bun.spawn(["git", ...args], { cwd, env: GIT_ENV, stdout: "ignore", stderr: "pipe" });
    const err = await new Response(p.stderr).text();
    return { code: await p.exited, err: err.trim() };
  };

  async function start(job: string, boilerplateId: string, parent: string, name: string, fresh: boolean) {
    const bp = BOILERPLATES.find((b) => b.id === boilerplateId);
    if (!bp) throw new Error("Unknown boilerplate");
    const check = await checkTarget(parent, name);
    if (!check.ok) throw new Error(check.error);
    const state = { cancelled: false, target: check.target, created: !(await exists(check.target)), proc: undefined as ReturnType<typeof Bun.spawn> | undefined };
    jobs.set(job, state);

    void (async () => {
      const fail = async (message: string) => {
        if (state.created) await rm(state.target, { recursive: true, force: true });
        emit(job, state.cancelled ? { phase: "cancelled" } : { phase: "error", message });
      };
      try {
        await mkdir(dirname(state.target), { recursive: true });
        emit(job, { phase: "clone", percent: 0, label: "Connecting to GitHub" });
        const args = ["clone", "--progress", ...(fresh ? ["--depth", "1"] : []), bp.repo, state.target];
        const p = Bun.spawn(["git", ...args], { env: GIT_ENV, stdout: "ignore", stderr: "pipe" });
        state.proc = p;
        // git reports progress on stderr, rewriting the same line with \r.
        let tail = "", last = "";
        const dec = new TextDecoder();
        for await (const chunk of p.stderr as ReadableStream<Uint8Array>) {
          const parts = (tail + dec.decode(chunk)).split(/[\r\n]+/);
          tail = parts.pop() ?? "";
          for (const line of parts) {
            last = line || last;
            const m = line.match(/^(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files):\s+(\d+)%/);
            if (!m) continue;
            const pct = Number(m[2]);
            // Download is most of the wait: weight the phases so the bar only moves forward.
            const w: Record<string, [number, number]> = { "Counting objects": [0, 5], "Compressing objects": [5, 15], "Receiving objects": [15, 80], "Resolving deltas": [80, 92], "Updating files": [92, 100] };
            const [a, b] = w[m[1]];
            const label = m[1] === "Receiving objects" ? "Downloading files" : m[1] === "Resolving deltas" ? "Unpacking" : m[1] === "Updating files" ? "Writing files" : "Preparing";
            emit(job, { phase: "clone", percent: Math.round(a + ((b - a) * pct) / 100), label });
          }
        }
        const code = await p.exited;
        if (state.cancelled) return fail("Cancelled");
        if (code !== 0) return fail(last.replace(/^fatal:\s*/, "") || "git clone failed");

        if (fresh) {
          emit(job, { phase: "git", label: "Starting a fresh git history" });
          await rm(join(state.target, ".git"), { recursive: true, force: true });
          const init = await run(state.target, ["init", "-q"]);
          if (init.code !== 0) return fail(init.err || "git init failed");
          await run(state.target, ["add", "-A"]);
          // Without a configured git identity the commit fails; the files stay staged and that is fine.
          await run(state.target, ["commit", "-q", "-m", `Initial commit from ${bp.name} boilerplate`]);
        }
        emit(job, { phase: "done", root: state.target });
      } catch (e) {
        await fail(String(e instanceof Error ? e.message : e));
      } finally {
        jobs.delete(job);
      }
    })();
  }

  return {
    start,
    cancel(job: string) {
      const j = jobs.get(job);
      if (!j) return;
      j.cancelled = true;
      j.proc?.kill();
    },
  };
}

export const defaultParent = async (hint?: string) => {
  for (const c of [hint, join(homedir(), "Developer"), join(homedir(), "Projects"), join(homedir(), "Documents")]) {
    if (c && (await exists(c))) return c;
  }
  return homedir();
};
