import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DATA_DIR } from "./paths";

// `shortcut` (prompts): one modifier plus one key, e.g. "Alt+1" or "Ctrl+K"; sends the template from anywhere in the app.
export type Template = { id: string; title: string; text: string; shortcut?: string };
export type Templates = { prompts: Template[]; terminals: Template[] };

const FILE = join(DATA_DIR, "templates.json");

const seed = (title: string, text: string): Template => ({ id: crypto.randomUUID().slice(0, 8), title, text });
// Starter set, written only the first time (so deleting one never brings it back).
const DEFAULTS = (): Templates => ({
  prompts: [
    seed("Explain this project", "Explain the structure of this project: the main folders, the entry points and how the pieces fit together."),
    seed("Review my changes", "Review the uncommitted changes (git diff). Point out bugs, risky parts and anything missing. Be concise."),
    seed("Write tests", "Write tests for the code I changed recently. Follow the existing test style and run them."),
    seed("Fix a bug", "Find and fix the bug described below. Explain the root cause first, then make the smallest fix.\n\n"),
    seed("Commit message", "Look at the current changes and write a clear commit message (short subject, then a few bullet points)."),
    seed("Refactor", "Refactor the code I point you to for readability, without changing behaviour. Keep the diff small."),
  ],
  terminals: [
    seed("Git status", "git status -sb"),
    seed("Git log", "git log --oneline --graph -15"),
    seed("Install dependencies", "bun install"),
    seed("Dev server", "bun run dev"),
    seed("Docker: compose up", "docker compose up -d"),
    seed("Docker: running containers", "docker ps"),
  ],
});

const clean = (list: unknown): Template[] =>
  (Array.isArray(list) ? list : []).slice(0, 500).flatMap((t: any) =>
    t && typeof t.title === "string" && typeof t.text === "string"
      ? [{
          id: typeof t.id === "string" && t.id ? t.id.slice(0, 40) : crypto.randomUUID().slice(0, 8), title: t.title.slice(0, 120), text: t.text.slice(0, 20_000),
          ...(typeof t.shortcut === "string" && /^(Ctrl|Alt|Meta)\+[A-Z0-9]$/.test(t.shortcut) ? { shortcut: t.shortcut } : {}),
        }]
      : []);

export const templates = {
  async load(): Promise<Templates> {
    try {
      const raw = JSON.parse(await readFile(FILE, "utf8"));
      return { prompts: clean(raw.prompts), terminals: clean(raw.terminals) };
    } catch {
      const d = DEFAULTS();
      await templates.save(d);
      return d;
    }
  },
  async save(t: Templates) {
    await mkdir(DATA_DIR, { recursive: true });
    const v = { prompts: clean(t.prompts), terminals: clean(t.terminals) };
    await writeFile(FILE, JSON.stringify(v, null, 2));
    return v;
  },
};
