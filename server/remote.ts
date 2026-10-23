import type { Account } from "./accounts";

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_BIN as bin } from "./paths";

export type RemoteState = {
  project: string;
  status: "starting" | "connected" | "error" | "stopped";
  account: string;
  mode: string;      // the IDE's permission mode the phone's sessions run with
  url?: string;     // opens this machine's environment in the Claude app / claude.ai/code
  session?: string;  // the session the phone is attached to
  error?: string;
  untrusted?: boolean; // Claude Code won't run here until the user accepts its trust dialog themselves
  trustCommand?: string; // command that opens that dialog in Terminal
  root?: string;         // the folder this is about
  note?: string;         // progress message while "starting" (for example, waiting to retry)
};

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

const RETRY_MS = 20_000;     // Claude keeps a folder's previous registration alive for about a minute after a hard kill
const MAX_RETRIES = 6;
const CONNECT_TIMEOUT_MS = 45_000;
// IDE mode → the CLI's --permission-mode for the sessions the phone opens (same mapping as the chat tabs).
const MODES = { manual: "default", edit: "acceptEdits", plan: "plan", auto: "auto" } as const;

// Claude Code "Remote Control": a long-running `claude remote-control` per project folder. It registers this
// Mac with claude.ai so the Claude mobile app / claude.ai/code can open sessions in that folder.
export function makeRemote(broadcast: (m: unknown) => void) {
  const procs = new Map<string, ReturnType<typeof Bun.spawn>>();
  const states = new Map<string, RemoteState>();
  const stopping = new Set<string>();                      // stopped by the user: don't retry
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const set = (project: string, patch: Partial<RemoteState>) => {
    const next = { ...states.get(project)!, ...patch };
    states.set(project, next);
    broadcast({ type: "remote-status", ...next });
  };
  const clearTimer = (project: string) => { clearTimeout(timers.get(project)); timers.delete(project); };

  function launch(project: string, root: string, name: string, account: Account, mode: string, attempt: number) {
    const permission = MODES[mode as keyof typeof MODES] ?? "default";
    const p = Bun.spawn([bin, "remote-control", "--name", `Vibecoder · ${name}`, "--permission-mode", permission], {
      cwd: root,
      env: { ...process.env, CLAUDE_CONFIG_DIR: account.dir },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    procs.set(project, p);

    let answered = false;
    let errText = "";
    let outText = "";
    let busy = false; // another Remote Control still holds this folder
    const read = async (s: ReadableStream, isErr: boolean) => {
      const dec = new TextDecoder();
      for await (const chunk of s) {
        const raw = dec.decode(chunk);
        if (isErr) {
          errText += raw.replace(ANSI, "");
          if (/already served/i.test(errText)) busy = true;
          continue;
        }
        // The first run asks for confirmation; we only get here because the user clicked Start.
        if (!answered && /Enable Remote Control\?/.test(raw)) { answered = true; p.stdin.write("y\n"); p.stdin.flush(); }
        const session = /https:\/\/claude\.ai\/code\/session_[\w-]+/.exec(raw)?.[0]; // inside an OSC-8 hyperlink
        const text = raw.replace(ANSI, "");
        outText = (outText + text).slice(-600);
        const url = /https:\/\/claude\.ai\/code\?environment=[\w-]+/.exec(text)?.[0];
        if (url || session) set(project, { ...(url ? { url } : {}), ...(session ? { session } : {}) });
        if (/Connected/.test(text)) { clearTimer(project); set(project, { status: "connected", note: undefined }); }
      }
    };
    void read(p.stdout as ReadableStream, false);
    void read(p.stderr as ReadableStream, true);

    // Slow start: say why it might be, instead of a bare "Connecting…".
    setTimeout(() => {
      if (procs.get(project) === p && states.get(project)?.status === "starting" && !states.get(project)?.note)
        set(project, { note: "Still connecting… If this doesn't finish, another Remote Control may already be serving this folder (for example a terminal running `claude remote-control`)." });
    }, 10_000);

    // Never sit on "Connecting…" forever: surface what the CLI said.
    clearTimer(project);
    timers.set(project, setTimeout(() => {
      if (procs.get(project) === p && states.get(project)?.status === "starting" && !busy) {
        const said = (errText.trim() || outText.trim()).split("\n").filter(Boolean).slice(-4).join("\n");
        p.kill();
        set(project, { status: "error", error: `Could not connect within ${CONNECT_TIMEOUT_MS / 1000}s.${said ? `\n${said}` : ""}` });
        procs.delete(project);
      }
    }, CONNECT_TIMEOUT_MS));

    void p.exited.then((code) => {
      if (procs.get(project) !== p) return;
      procs.delete(project);
      clearTimer(project);
      if (stopping.delete(project)) {
        set(project, { status: "stopped", url: undefined, session: undefined, error: undefined, note: undefined, untrusted: false });
        return;
      }
      if (busy) {
        // The previous registration for this folder hasn't expired yet (e.g. after a restart): keep trying quietly.
        if (attempt < MAX_RETRIES) {
          set(project, { status: "starting", note: `Waiting for the previous Remote Control session on this folder to expire… (retry ${attempt + 1}/${MAX_RETRIES})` });
          timers.set(project, setTimeout(() => { if (!stopping.has(project)) launch(project, root, name, account, mode, attempt + 1); }, RETRY_MS));
          return;
        }
        set(project, { status: "error", note: undefined, error: "This folder is still registered by another Remote Control (a terminal `claude remote-control`, or an earlier session that hasn't expired). Stop it, wait a minute, then press Start." });
        return;
      }
      const untrusted = /not trusted/i.test(errText);
      const msg = errText.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("[bridge]")).join("\n");
      set(project, code === 0 && !msg
        ? { status: "stopped", url: undefined, session: undefined, error: undefined, note: undefined, untrusted: false }
        : {
            status: "error", note: undefined, error: msg || `Exited with code ${code}`, untrusted,
            // Workspace trust is the user's call: we only show how to get the dialog, never accept it for them.
            trustCommand: untrusted ? `cd '${root}' && CLAUDE_CONFIG_DIR='${account.dir}' '${bin}'` : undefined,
          });
    });
  }

  // Ctrl+C (SIGINT) lets the CLI unregister from claude.ai; a hard kill leaves the folder "taken" for about a minute.
  const stopOne = (project: string): Promise<void> => {
    const p = procs.get(project);
    clearTimer(project);
    if (!p) return Promise.resolve();
    stopping.add(project);
    p.kill("SIGINT");
    const hard = setTimeout(() => p.kill("SIGTERM"), 4000);
    return p.exited.then(() => clearTimeout(hard), () => clearTimeout(hard));
  };

  return {
    list: () => [...states.values()],
    start(project: string, root: string, name: string, account: Account, mode = "manual") {
      if (procs.has(project)) return states.get(project)!;
      stopping.delete(project);
      if (!(mode in MODES)) mode = "manual";
      states.set(project, { project, status: "starting", account: account.id, mode, root });
      broadcast({ type: "remote-status", ...states.get(project)! });
      launch(project, root, name, account, mode, 0);
      return states.get(project)!;
    },
    stop(project: string) {
      void stopOne(project);
      // A pending retry has no process to stop; reflect the stop right away.
      if (!procs.has(project)) set(project, { status: "stopped", note: undefined, error: undefined });
    },
    // Used on shutdown: wait (briefly) for each CLI to unregister before we exit.
    async stopAll() {
      await Promise.race([Promise.all([...procs.keys()].map(stopOne)), new Promise((r) => setTimeout(r, 5000))]);
    },
  };
}

// Records the same "I trust this folder" choice Claude Code's own dialog stores. It is only reached from the UI's
// confirmation popup, after the user clicked "Yes, I trust this folder" for that specific folder.
export async function trustFolder(account: Account, root: string) {
  const file = join(account.dir, ".claude.json");
  const cfg = await readFile(file, "utf8").then(JSON.parse, () => ({}));
  cfg.projects ??= {};
  cfg.projects[root] = { ...cfg.projects[root], hasTrustDialogAccepted: true };
  await mkdir(account.dir, { recursive: true });
  await writeFile(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
