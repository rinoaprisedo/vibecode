import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DATA_DIR } from "./paths";
import { projectId } from "./projects";

// Token usage per folder (project), added up from the usage Claude reports at the end of every turn, in total and per day / per model
// (the Usage page draws its charts from this). Kept in the data folder so the numbers survive restarts.
// "since" is when counting started for the folder (or was last reset); days older than a year are dropped.
export type ModelStat = { tokens: number; cost: number };
export type DayStat = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number; models?: Record<string, ModelStat> };
export type TokenStat = DayStat & { since: number; days?: Record<string, DayStat> };
const FILE = join(DATA_DIR, "tokens.json");
const KEEP_DAYS = 365;
const blank = (): DayStat => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 });

let data: Record<string, TokenStat> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const load = async (): Promise<Record<string, TokenStat>> =>
  (data ??= await readFile(FILE, "utf8").then((t) => JSON.parse(t) as Record<string, TokenStat>, () => ({} as Record<string, TokenStat>)));
const save = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => { try { await mkdir(DATA_DIR, { recursive: true }); await writeFile(FILE, JSON.stringify(data)); } catch {} }, 600);
};
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; // local date

function addTo(s: DayStat, usage: any, cost: number, models: Record<string, ModelStat>) {
  s.input += n(usage?.input_tokens); s.output += n(usage?.output_tokens);
  s.cacheRead += n(usage?.cache_read_input_tokens); s.cacheWrite += n(usage?.cache_creation_input_tokens);
  s.cost += cost; s.turns += 1;
  for (const [name, m] of Object.entries(models)) {
    const t = ((s.models ??= {})[name] ??= { tokens: 0, cost: 0 });
    t.tokens += m.tokens; t.cost += m.cost;
  }
}

export const tokens = {
  // `modelUsage` is the per-model breakdown of the same turn (Claude may use a second, lighter model for small jobs).
  async add(root: string, usage: any, cost?: number, modelUsage?: Record<string, any>) {
    const all = await load();
    const s = (all[projectId(root)] ??= { ...blank(), since: Date.now() });
    const models: Record<string, ModelStat> = {};
    for (const [name, m] of Object.entries(modelUsage ?? {})) {
      models[name] = { tokens: n(m?.inputTokens) + n(m?.outputTokens) + n(m?.cacheCreationInputTokens), cost: n(m?.costUSD) };
    }
    addTo(s, usage, n(cost), models);
    const days = (s.days ??= {});
    addTo((days[dayKey()] ??= blank()), usage, n(cost), models);
    const keys = Object.keys(days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
    save();
  },
  all: () => load(),
  async reset(id: string) { const all = await load(); delete all[id]; save(); return all; },
};
