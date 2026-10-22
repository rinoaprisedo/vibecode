import { join } from "node:path";
import { mkdir, readFile, writeFile, rm, copyFile, readdir, stat } from "node:fs/promises";
import { DATA_DIR } from "./paths";

export type Account = { id: string; name: string; dir: string; color?: string };

const ROOT = DATA_DIR;
const FILE = join(ROOT, "accounts.json");

// The original login keeps working: it becomes the "default" account.
export const DEFAULT_DIR = process.env.VIBECODE_CLAUDE_DIR ?? join(ROOT, "claude");
const DEFAULT: Account = { id: "default", name: "Account 1", dir: DEFAULT_DIR };

let cache: Account[] | undefined;

async function load(): Promise<Account[]> {
  if (cache) return cache;
  const saved: Account[] = await readFile(FILE, "utf8").then(JSON.parse, () => []);
  DEFAULT.color = saved.find((a) => a.id === "default")?.color;
  cache = [DEFAULT, ...saved.filter((a) => a.id !== "default")];
  return cache;
}
const persist = async () => {
  await mkdir(ROOT, { recursive: true });
  await writeFile(FILE, JSON.stringify(cache!.filter((a) => a.id !== "default" || a.color)));
};

// Each Claude account is its own config dir (login, sessions); a chat picks which one to run with.
export const accounts = {
  list: load,
  async get(id: string | undefined): Promise<Account> {
    const all = await load();
    return all.find((a) => a.id === (id || "default")) ?? all[0];
  },
  async add(name: string): Promise<Account> {
    const all = await load();
    const id = crypto.randomUUID().slice(0, 8);
    const acc: Account = { id, name: name.trim() || `Account ${all.length + 1}`, dir: join(ROOT, "accounts", id) };
    await mkdir(acc.dir, { recursive: true });
    all.push(acc);
    await persist();
    return acc;
  },
  async rename(id: string, name: string) {
    const acc = (await load()).find((a) => a.id === id);
    if (acc && name.trim()) { acc.name = name.trim(); await persist(); }
  },
  async setColor(id: string, color: string) {
    const acc = (await load()).find((a) => a.id === id);
    if (acc && /^#[0-9a-f]{6}$/i.test(color)) { acc.color = color; await persist(); }
  },
  async remove(id: string) {
    if (id === "default") throw new Error("The default account can't be removed");
    const all = await load();
    const acc = all.find((a) => a.id === id);
    if (!acc) return;
    cache = all.filter((a) => a.id !== id);
    await persist();
    await rm(acc.dir, { recursive: true, force: true });
  },

  // A conversation lives in the account's config dir. When a chat switches accounts, copy its
  // transcript over so the new account can resume it.
  async ensureSession(target: Account, sessionId: string) {
    if (!/^[\w-]+$/.test(sessionId)) return;
    const find = async (dir: string) => {
      const base = join(dir, "projects");
      for (const d of await readdir(base).catch(() => [] as string[])) {
        const f = join(base, d, sessionId + ".jsonl");
        if (await stat(f).then(() => true, () => false)) return { rel: join(d, sessionId + ".jsonl"), full: f };
      }
    };
    if (await find(target.dir)) return;
    for (const other of await load()) {
      if (other.id === target.id) continue;
      const hit = await find(other.dir);
      if (!hit) continue;
      const dest = join(target.dir, "projects", hit.rel);
      await mkdir(join(dest, ".."), { recursive: true });
      await copyFile(hit.full, dest);
      return;
    }
  },
};

// Is the account that just signed in the same Anthropic account as another one already added?
// Compares sign-in emails; accounts without an email (API-key style) can't be compared and are allowed.
export async function findDuplicate(
  meId: string,
  statusOf: (a: Account) => Promise<{ loggedIn: boolean; email?: string }>,
): Promise<{ name: string; email: string } | null> {
  const all = await load();
  const me = all.find((a) => a.id === meId);
  if (!me) return null;
  const mine = (await statusOf(me)).email?.trim().toLowerCase();
  if (!mine) return null;
  for (const other of all) {
    if (other.id === meId) continue;
    const s = await statusOf(other);
    if (s.loggedIn && s.email?.trim().toLowerCase() === mine) return { name: other.name, email: s.email! };
  }
  return null;
}
