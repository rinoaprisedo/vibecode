import { watch, type FSWatcher } from "node:fs";
import { basename, join, resolve } from "node:path";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { makeFs } from "./fs";
import { makeGit } from "./git";
import { makeChats } from "./chats";
import { DATA_DIR } from "./paths";

export type Project = {
  id: string;
  root: string;
  name: string;
  fs: ReturnType<typeof makeFs>;
  git: ReturnType<typeof makeGit>;
  chats: ReturnType<typeof makeChats>;
};

const FILE = join(DATA_DIR, "projects.json");
// Same hash chats are stored under, so existing chat history keeps belonging to its folder.
export const projectId = (root: string) => createHash("sha1").update(root).digest("hex").slice(0, 12);

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

// The set of folders open at once. Each has its own fs/git/chat store and file watcher.
export function makeProjects(onFsChanged: (projectId: string, path: string | null) => void) {
  const projects = new Map<string, Project>();
  const watchers = new Map<string, FSWatcher>();
  const timers = new Map<string, Timer>();

  let recent: string[] = []; // folders that were open before, newest first

  const save = () =>
    mkdir(DATA_DIR, { recursive: true })
      .then(() => writeFile(FILE, JSON.stringify({ open: [...projects.values()].map((p) => p.root), recent })));

  const watchProject = (p: Project) => {
    watchers.set(p.id, watch(p.root, { recursive: true }, (_e, name) => {
      if (name && /(^|\/)(\.git\/(?!index$)|node_modules)/.test(name)) return;
      clearTimeout(timers.get(p.id));
      p.fs.invalidate(); // the file list used by quick-open is stale now
      timers.set(p.id, setTimeout(() => onFsChanged(p.id, name), 150));
    }));
  };

  async function add(path: string, persist = true): Promise<Project> {
    const root = resolve(path.replace(/^~(?=$|[\/\\])/, process.env.HOME ?? process.env.USERPROFILE ?? "~"));
    if (!(await isDir(root))) throw new Error(`Not a folder: ${root}`);
    const id = projectId(root);
    const existing = projects.get(id);
    if (existing) return existing;
    const p: Project = { id, root, name: basename(root) || root, fs: makeFs(root), git: makeGit(root), chats: makeChats(() => root) };
    projects.set(id, p);
    recent = recent.filter((r) => r !== root);
    watchProject(p);
    if (persist) await save();
    return p;
  }

  return {
    add,
    async remove(id: string) {
      watchers.get(id)?.close(); watchers.delete(id);
      const gone = projects.get(id);
      projects.delete(id);
      if (gone) recent = [gone.root, ...recent.filter((r) => r !== gone.root)].slice(0, 12);
      await save();
    },
    get(id: string | null | undefined): Project {
      const p = id ? projects.get(id) : undefined;
      if (!p) throw new Error("unknown project");
      return p;
    },
    first: () => projects.values().next().value as Project | undefined,
    list: () => [...projects.values()],
    recent: () => recent.map((root) => ({ root, name: basename(root) || root })),
    // Restore folders from the last run (skipping ones that no longer exist).
    async load() {
      const saved = await readFile(FILE, "utf8").then(JSON.parse, () => []);
      const open: string[] = Array.isArray(saved) ? saved : saved.open ?? []; // older files were a plain array
      recent = (Array.isArray(saved) ? [] : saved.recent ?? []).filter((r: string) => !open.includes(r));
      for (const r of open) await add(r, false).catch(() => {});
    },
  };
}
