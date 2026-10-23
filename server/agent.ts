import { isWin, winBeep, winNotify } from "./platform";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { basename } from "node:path";
import { accounts } from "./accounts";
import { CLAUDE_BIN } from "./paths";
import { images as imageStore } from "./images";
import { authStatus } from "./auth";
import { getUsage } from "./usage";


type Send = (msg: unknown) => void;

export type RunOpts = { mode?: string; effort?: string; ultracode?: boolean; resume?: string; sound?: boolean; model?: string; account?: string; autoSwitch?: boolean };

const MODES = { manual: "default", edit: "acceptEdits", plan: "plan", auto: "auto" } as const;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const clip = (t: string, n: number) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};

// macOS notification banner. Text goes in as argv so it can't be interpreted as AppleScript.
// Inside the Mac app the UI posts the banner itself (so clicking it can open the chat); this is the browser fallback.
function banner(title: string, body: string, subtitle: string) {
  if (isWin) return winNotify(title, `${subtitle}: ${body}`);
  if (process.env.VIBECODE_APP) return;
  Bun.spawn(
    ["osascript",
      "-e", "on run argv",
      "-e", "display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)",
      "-e", "end run",
      body, title, subtitle],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
}

// Hitting a plan limit shows up as a rejected rate_limit_event, an assistant message flagged rate_limit,
// or an error result whose text says so.
const LIMIT_TEXT = /hit your (usage )?limit|usage limit reached|rate limit|limit reached|out of (extra )?usage/i;
const isLimitHit = (m: any) =>
  (m.type === "rate_limit_event" && m.rate_limit_info?.status === "rejected")
  || (m.type === "assistant" && m.error === "rate_limit")
  || (m.type === "result" && m.is_error && LIMIT_TEXT.test(String(m.result ?? m.errors?.join(" ") ?? "")));

// Next account that is signed in, wasn't tried yet and still has room in its 5-hour and 7-day windows.
async function pickFallback(root: string, tried: Set<string>) {
  for (const a of await accounts.list()) {
    if (tried.has(a.id)) continue;
    if (!(await authStatus(a.dir)).loggedIn) continue;
    const u = await getUsage(root, a.dir).catch(() => undefined);
    const full = [u?.five_hour, u?.seven_day].some((w) => (w?.utilization ?? 0) >= 100);
    if (!full) return a;
  }
}

// One agent run per chat; several chats can run at once. Every outgoing message is tagged with
// its chatId so the UI can route it even when another session is on screen.
export function makeAgent(send: Send) {
  const runs = new Map<string, AbortController>();
  const pending = new Map<string, { chatId: string; resolve: (r: { allow: boolean; answers?: Record<string, string>; message?: string; mode?: string }) => void }>();

  const stop = (chatId: string) => {
    runs.get(chatId)?.abort();
    for (const [id, p] of pending) {
      if (p.chatId !== chatId) continue;
      p.resolve({ allow: false });
      pending.delete(id);
    }
  };

  return {
    answerPermission(id: string, allow: boolean, answers?: Record<string, string>, message?: string, mode?: string) {
      pending.get(id)?.resolve({ allow, answers, message, mode });
      pending.delete(id);
    },
    stop,
    stopAll: () => [...runs.keys()].forEach(stop),
    async run(chatId: string, root: string, prompt: string, opts: RunOpts = {}, imageIds: string[] = []) {
      if (runs.has(chatId)) { send({ type: "rejected", chatId }); return; } // already working on this chat
      const out = (m: Record<string, unknown>) => send({ ...m, chatId });
      let account = await accounts.get(opts.account);
      const abort = new AbortController();
      let lastText = "";
      let lastUsage: any, lastModel = "";
      runs.set(chatId, abort);
      try {
        const tried = new Set<string>([account.id]);
        let resume = opts.resume;
        let text = prompt;
        let withImages = true;
        for (;;) {
        if (resume) await accounts.ensureSession(account, resume);
        // With attachments the prompt is one user message made of image blocks followed by the text.
        let input: Parameters<typeof query>[0]["prompt"] = text;
        if (imageIds.length && withImages) {
          const blocks: any[] = [];
          for (const id of imageIds.slice(0, 8)) {
            const img = await imageStore.read(id);
            blocks.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.data.toString("base64") } });
          }
          blocks.push({ type: "text", text: text || "(see the attached image)" });
          input = (async function* () {
            yield { type: "user" as const, message: { role: "user" as const, content: blocks }, parent_tool_use_id: null };
          })();
        }
        let progressed = false, switchTo: typeof account | undefined, sessionId = resume;
        const stream = query({
          prompt: input,
          options: {
            cwd: root,
            pathToClaudeCodeExecutable: CLAUDE_BIN,
            env: { ...process.env, CLAUDE_CONFIG_DIR: account.dir },
            settingSources: [],
            permissionMode: MODES[opts.mode as keyof typeof MODES] ?? "default",
            effort: EFFORTS.find((e) => e === opts.effort),
            settings: opts.ultracode ? { ultracode: true } : undefined,
            model: opts.model || undefined,
            abortController: abort,
            resume: resume || undefined,
            canUseTool: async (toolName, input) => {
              const id = crypto.randomUUID();
              out({ type: "permission", id, tool: toolName, input });
              // Same chime + banner as a finished reply, so a waiting approval doesn't go unnoticed.
              if (opts.sound !== false) {
                const i = input as Record<string, unknown>;
                const what = toolName === "ExitPlanMode" ? "Plan ready for review"
                  : toolName === "AskUserQuestion" ? String((i.questions as any)?.[0]?.question ?? "Claude has a question")
                  : String(i.command ?? i.file_path ?? i.url ?? i.pattern ?? toolName);
                if (isWin) winBeep("Exclamation"); else Bun.spawn(["afplay", "/System/Library/Sounds/Ping.aiff"], { stdio: ["ignore", "ignore", "ignore"] });
                banner("Needs your approval", `${toolName}: ${clip(what, 120)}`, basename(root));
              }
              const { allow, answers, message, mode } = await new Promise<{ allow: boolean; answers?: Record<string, string>; message?: string; mode?: string }>((resolve) => pending.set(id, { chatId, resolve }));
              return allow
                ? {
                  behavior: "allow", updatedInput: answers ? { ...input, answers } : input,
                  // Approving a plan can also switch the rest of the session to auto-editing.
                  ...(toolName === "ExitPlanMode" && mode === "edit" ? { updatedPermissions: [{ type: "setMode" as const, mode: "acceptEdits" as const, destination: "session" as const }] } : {}),
                }
                : { behavior: "deny", message: message || "Denied by user" };
            },
          },
        });
        for await (const m of stream) {
          if ((m as any).session_id) sessionId = (m as any).session_id;
          if (opts.autoSwitch !== false && !abort.signal.aborted && isLimitHit(m)) {
            const next = await pickFallback(root, tried);
            if (next) { switchTo = next; stream.close(); break; } // swallow the limit messages and carry on elsewhere
          }
          if (m.type === "assistant" && !m.parent_tool_use_id) { lastUsage = m.message.usage; lastModel = m.message.model; }
          if (m.type === "result" && lastUsage) {
            // Context in use = what the last main-loop call read plus what it wrote.
            const used = (lastUsage.input_tokens ?? 0) + (lastUsage.cache_read_input_tokens ?? 0)
              + (lastUsage.cache_creation_input_tokens ?? 0) + (lastUsage.output_tokens ?? 0);
            const windows = Object.entries(m.modelUsage ?? {}) as [string, { contextWindow?: number }][];
            const max = windows.find(([k]) => k === lastModel)?.[1].contextWindow ?? Math.max(0, ...windows.map(([, u]) => u.contextWindow ?? 0));
            if (max) out({ type: "context", used, max });
          }
          if (m.type === "assistant") {
            const t = m.message.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
            if (t) lastText = t;
            if (m.message.content.some((b: any) => b.type === "tool_use" || (b.type === "text" && b.text?.trim()))) progressed = true;
          }
          out({ type: "sdk", message: m });
        }
        if (!switchTo || abort.signal.aborted) break;
        const from = account;
        account = switchTo; tried.add(account.id);
        resume = progressed ? sessionId : opts.resume; // no progress: the new account starts the turn from scratch
        // Mid-task: ask the new account to carry on. Nothing done yet: just send the same message again.
        if (progressed) { text = "Your previous account hit its usage limit and the work was moved to this one. Continue exactly where you left off."; withImages = false; }
        out({ type: "account-switched", from: from.id, fromName: from.name, to: account.id, toName: account.name });
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          const msg = String(e);
          const hint = /not logged in|\/login/i.test(msg)
            ? `\n\nBelum login ke akun ini. Buka Settings → Accounts untuk login.`
            : "";
          out({ type: "error", error: msg + hint });
        }
      } finally {
        runs.delete(chatId);
        // Chime + notification when a reply finishes (not when the user pressed Stop).
        const notify = !abort.signal.aborted && opts.sound !== false;
        if (notify) {
          if (isWin) winBeep(); else Bun.spawn(["afplay", "/System/Library/Sounds/Glass.aiff"], { stdio: ["ignore", "ignore", "ignore"] });
          banner(clip(prompt, 60), clip(lastText, 140) || "Done", basename(root));
        }
        out({ type: "done", notify: notify ? { title: clip(prompt, 60), body: clip(lastText, 140) || "Done" } : undefined });
      }
    },
  };
}
