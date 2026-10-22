import { query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_BIN } from "./paths";

export type Usage = {
  available: boolean;
  five_hour?: { utilization: number | null; resets_at: string | null } | null;
  seven_day?: { utilization: number | null; resets_at: string | null } | null;
};

// Cached per account (each has its own rate limits).
const cache = new Map<string, { at: number; value: Usage }>();
const inflight = new Map<string, Promise<Usage>>();

// Plan rate-limit utilization via the SDK's (experimental) usage control request.
// Starts the CLI without sending any prompt, so it costs no tokens.
async function load(cwd: string, dir: string): Promise<Usage> {
  const idle = (async function* (): AsyncGenerator<never> { await new Promise<void>(() => {}); })();
  const q = query({ prompt: idle, options: { cwd, pathToClaudeCodeExecutable: CLAUDE_BIN, env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, settingSources: [] } });
  try {
    const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    if (!u.rate_limits_available || !u.rate_limits) return { available: false };
    return { available: true, five_hour: u.rate_limits.five_hour, seven_day: u.rate_limits.seven_day };
  } finally {
    q.close();
  }
}

export function getUsage(cwd: string, dir: string): Promise<Usage> {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < 15_000) return Promise.resolve(hit.value);
  let p = inflight.get(dir);
  if (!p) {
    p = load(cwd, dir)
      .then((value) => { cache.set(dir, { at: Date.now(), value }); return value; })
      .finally(() => inflight.delete(dir));
    inflight.set(dir, p);
  }
  return p;
}
