import { query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_BIN } from "./paths";

export type Model = { value: string; displayName: string; description: string };

const cache = new Map<string, { at: number; value: Model[] }>();
const inflight = new Map<string, Promise<Model[]>>();

// Models available to the signed-in account. Starts the CLI without a prompt, so it costs no tokens.
async function load(cwd: string, dir: string): Promise<Model[]> {
  const idle = (async function* (): AsyncGenerator<never> { await new Promise<void>(() => {}); })();
  const q = query({ prompt: idle, options: { cwd, pathToClaudeCodeExecutable: CLAUDE_BIN, env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, settingSources: [] } });
  try {
    const list = await q.supportedModels();
    return list.map(({ value, displayName, description }) => ({ value, displayName, description }));
  } finally {
    q.close();
  }
}

export function getModels(cwd: string, dir: string): Promise<Model[]> {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < 10 * 60_000) return Promise.resolve(hit.value);
  let p = inflight.get(dir);
  if (!p) {
    p = load(cwd, dir)
      .then((value) => { cache.set(dir, { at: Date.now(), value }); return value; })
      .finally(() => inflight.delete(dir));
    inflight.set(dir, p);
  }
  return p;
}
