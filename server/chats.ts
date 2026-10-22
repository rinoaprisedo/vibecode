import { join } from "node:path";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DATA_DIR } from "./paths";

export type Chat = {
  id: string;
  title: string;
  updatedAt: number;
  claudeSession?: string; // Agent SDK session id, used to resume the conversation
  context?: { used: number; max: number }; // last known context-window fill
  items: unknown[];
};

const ID = /^[\w-]{1,64}$/;

// Chats are stored per project folder under <data dir>/chats/<hash-of-folder>/.
export function makeChats(getRoot: () => string) {
  const dir = () => join(DATA_DIR, "chats", createHash("sha1").update(getRoot()).digest("hex").slice(0, 12));
  const file = (id: string) => {
    if (!ID.test(id)) throw new Error("bad chat id");
    return join(dir(), id + ".json");
  };

  return {
    async list() {
      const names = await readdir(dir()).catch(() => [] as string[]);
      const chats = await Promise.all(
        names.filter((n) => n.endsWith(".json")).map(async (n) => {
          const c: Chat = JSON.parse(await readFile(join(dir(), n), "utf8"));
          return { id: c.id, title: c.title, updatedAt: c.updatedAt };
        }),
      );
      return chats.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id: string): Promise<Chat> {
      return JSON.parse(await readFile(file(id), "utf8"));
    },
    async save(id: string, chat: Chat) {
      await mkdir(dir(), { recursive: true });
      await writeFile(file(id), JSON.stringify({ ...chat, id, updatedAt: Date.now() }));
    },
    remove: (id: string) => rm(file(id), { force: true }),
  };
}
