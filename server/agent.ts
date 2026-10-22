import { query } from "@anthropic-ai/claude-agent-sdk";
import { basename } from "node:path";
import { accounts } from "./accounts";
import { CLAUDE_BIN } from "./paths";
import { images as imageStore } from "./images";


type Send = (msg: unknown) => void;

export type RunOpts = { mode?: string; effort?: string; ultracode?: boolean; resume?: string; sound?: boolean; model?: string; account?: string };

const MODES = { manual: "default", edit: "acceptEdits", plan: "plan", auto: "auto" } as const;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const clip = (t: string, n: number) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};

// macOS notification banner. Text goes in as argv so it can't be interpreted as AppleScript.
function banner(title: string, body: string, subtitle: string) {
  Bun.spawn(
    ["osascript",
      "-e", "on run argv",
      "-e", "display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)",
      "-e", "end run",
      body, title, subtitle],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
}

// One agent run per chat; several chats can run at once. Every outgoing message is tagged with
// its chatId so the UI can route it even when another session is on screen.
export function makeAgent(send: Send) {
  const runs = new Map<string, AbortController>();
  const pending = new Map<string, { chatId: string; resolve: (allow: boolean) => void }>();

  const stop = (chatId: string) => {
    runs.get(chatId)?.abort();
    for (const [id, p] of pending) {
      if (p.chatId !== chatId) continue;
      p.resolve(false);
      pending.delete(id);
    }
  };

  return {
    answerPermission(id: string, allow: boolean) {
      pending.get(id)?.resolve(allow);
      pending.delete(id);
    },
    stop,
    stopAll: () => [...runs.keys()].forEach(stop),
    async run(chatId: string, root: string, prompt: string, opts: RunOpts = {}, imageIds: string[] = []) {
      if (runs.has(chatId)) return;
      const out = (m: Record<string, unknown>) => send({ ...m, chatId });
      const account = await accounts.get(opts.account);
      const abort = new AbortController();
      let lastText = "";
      let lastUsage: any, lastModel = "";
      runs.set(chatId, abort);
      try {
        if (opts.resume) await accounts.ensureSession(account, opts.resume);
        // With attachments the prompt is one user message made of image blocks followed by the text.
        let input: Parameters<typeof query>[0]["prompt"] = prompt;
        if (imageIds.length) {
          const blocks: any[] = [];
          for (const id of imageIds.slice(0, 8)) {
            const img = await imageStore.read(id);
            blocks.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.data.toString("base64") } });
          }
          blocks.push({ type: "text", text: prompt || "(see the attached image)" });
          input = (async function* () {
            yield { type: "user" as const, message: { role: "user" as const, content: blocks }, parent_tool_use_id: null };
          })();
        }
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
            resume: opts.resume || undefined,
            canUseTool: async (toolName, input) => {
              const id = crypto.randomUUID();
              out({ type: "permission", id, tool: toolName, input });
              // Same chime + banner as a finished reply, so a waiting approval doesn't go unnoticed.
              if (opts.sound !== false) {
                const i = input as Record<string, unknown>;
                const what = toolName === "ExitPlanMode" ? "Plan ready for review"
                  : String(i.command ?? i.file_path ?? i.url ?? i.pattern ?? toolName);
                Bun.spawn(["afplay", "/System/Library/Sounds/Ping.aiff"], { stdio: ["ignore", "ignore", "ignore"] });
                banner(`Claude needs approval · ${basename(root)}`, `${toolName}: ${clip(what, 120)}`, clip(prompt, 60));
              }
              const allow = await new Promise<boolean>((resolve) => pending.set(id, { chatId, resolve }));
              return allow
                ? { behavior: "allow", updatedInput: input }
                : { behavior: "deny", message: "Denied by user" };
            },
          },
        });
        for await (const m of stream) {
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
          }
          out({ type: "sdk", message: m });
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
          Bun.spawn(["afplay", "/System/Library/Sounds/Glass.aiff"], { stdio: ["ignore", "ignore", "ignore"] });
          banner(`Claude finished · ${basename(root)}`, clip(lastText, 140) || "Done", clip(prompt, 60));
        }
        out({ type: "done", notify: notify ? { title: clip(prompt, 60), body: clip(lastText, 140) || "Done" } : undefined });
      }
    },
  };
}
