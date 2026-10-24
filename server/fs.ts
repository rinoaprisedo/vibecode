import { isMac, trashItem } from "./platform";
import { readdir, readFile, writeFile, mkdir, rename, rm, cp, stat } from "node:fs/promises";
import { resolve, relative, sep, dirname, join, basename, extname } from "node:path";

const IGNORED = new Set([".git", "node_modules", ".DS_Store", "dist"]);
// Quick-open skips build output and dependency folders too.
const SEARCH_SKIP = new Set([...IGNORED, "build", ".next", ".nuxt", "target", "vendor", "__pycache__", ".venv", "venv", ".cache", ".idea", ".gradle", "Pods", "coverage", ".turbo"]);
const MAX_FILES = 30_000;

const exists = (p: string) => stat(p).then(() => true, () => false);

// A single file or folder name: no slashes, not empty, not "." / "..".
export function validName(name: string) {
  const n = name.trim();
  if (!n || n === "." || n === ".." || /[\\/]/.test(n) || n.length > 255) throw new Error(`"${name}" is not a valid name`);
  return n;
}

// Finder-style collision handling: "a.txt" -> "a copy.txt" -> "a copy 2.txt".
async function uniqueIn(dir: string, name: string) {
  let candidate = name, i = 0;
  const ext = extname(name), stem = ext ? name.slice(0, -ext.length) : name;
  while (await exists(join(dir, candidate))) candidate = `${stem} copy${i++ ? ` ${i}` : ""}${ext}`;
  return candidate;
}

// Copy or move absolute paths into a destination folder. Returns the names created there.
export async function pasteInto(sources: string[], destDir: string, move: boolean): Promise<string[]> {
  const made: string[] = [];
  for (const src of sources) {
    const name = basename(src);
    if (destDir === src || destDir.startsWith(src + sep)) throw new Error(`Can't put "${name}" inside itself`);
    if (move && dirname(src) === destDir) { made.push(name); continue; } // already there
    const target = await uniqueIn(destDir, name);
    const dest = join(destDir, target);
    if (move) {
      await rename(src, dest).catch(async (e) => {          // other volume: copy, then remove the original
        if (e.code !== "EXDEV") throw e;
        await cp(src, dest, { recursive: true, errorOnExist: true });
        await rm(src, { recursive: true, force: true });
      });
    } else {
      await cp(src, dest, { recursive: true, errorOnExist: true });
    }
    made.push(target);
  }
  return made;
}

// Move to the macOS Trash (recoverable). Uses the same Foundation call Finder does, through JavaScript for Automation,
// so it needs no Finder/Automation permission prompt. A timeout keeps a stuck call from hanging the request.
async function moveToTrash(abs: string) {
  if (!isMac) return trashItem(abs);
  const script = 'ObjC.import("Foundation"); function run(a){ const e=Ref(); const ok=$.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(a[0]), null, e); if(!ok) throw new Error(ObjC.unwrap(e[0].localizedDescription)); }';
  const p = Bun.spawn(["osascript", "-l", "JavaScript", "-e", script, abs], { stdout: "ignore", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; p.kill(); }, 15_000);
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  clearTimeout(timer);
  if (code !== 0) throw new Error("Couldn't move to the Trash" + (timedOut ? " (timed out)" : err.trim() ? `: ${err.trim()}` : ""));
}

export function makeFs(root: string) {
  // Resolve a user-supplied relative path and refuse anything outside root.
  const jail = (p: string) => {
    const abs = resolve(root, "." + sep + p);
    const rel = relative(root, abs);
    if (rel.startsWith("..") || resolve(rel) === rel) throw new Error("path outside root");
    return abs;
  };

  // Every file path under root (relative), cached until the folder's watcher reports a change.
  let listing: { files: string[]; truncated: boolean } | null = null;
  async function walk(dir: string, rel: string, out: string[]): Promise<void> {
    if (out.length >= MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (SEARCH_SKIP.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(join(dir, e.name), r, out);
      else if (e.isFile()) { out.push(r); if (out.length >= MAX_FILES) return; }
    }
  }

  return {
    root,
    jail,
    invalidate() { listing = null; },
    async files() {
      if (!listing) {
        const files: string[] = [];
        await walk(root, "", files);
        listing = { files, truncated: files.length >= MAX_FILES };
      }
      return listing;
    },
    async tree(p: string) {
      const entries = await readdir(jail(p), { withFileTypes: true });
      return entries
        .filter((e) => !IGNORED.has(e.name))
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    },
    read: (p: string) => readFile(jail(p), "utf8"),
    async create(p: string, kind: "file" | "dir") {
      const abs = jail(p);
      validName(basename(abs));
      if (await exists(abs)) throw new Error(`"${basename(abs)}" already exists here`);
      if (kind === "dir") await mkdir(abs, { recursive: true });
      else { await mkdir(dirname(abs), { recursive: true }); await writeFile(abs, "", { flag: "wx" }); }
    },
    async rename(from: string, to: string) {
      const a = jail(from), b = jail(to);
      if (a === root) throw new Error("Can't rename the project folder here");
      validName(basename(b));
      if (a === b) return;
      if (await exists(b)) throw new Error(`"${basename(b)}" already exists here`);
      await rename(a, b);
    },
    async remove(p: string, permanent: boolean) {
      const abs = jail(p);
      if (abs === root) throw new Error("Use Remove from Vibecoder to close the project folder");
      if (!(await exists(abs))) throw new Error(`"${basename(abs)}" no longer exists`);
      if (permanent) await rm(abs, { recursive: true, force: true });
      else await moveToTrash(abs);
    },
    async write(p: string, content: string) {
      const abs = jail(p);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    },
  };
}
