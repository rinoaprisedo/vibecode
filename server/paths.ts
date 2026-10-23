import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

// Where settings, logins, chats and the list of open folders are kept. The packaged app points this at its own
// folder (~/Library/Application Support/Vibecode) so a fresh install starts empty and never reuses a developer's state.
// Packaged Windows build: vibecode-server.exe sits in <install>\server, with web\ and claude\ next to it, and keeps its
// data in %APPDATA%\Vibecode. (macOS passes the same things through environment variables set by its launcher.)
const winPackaged = process.platform === "win32" && !/^bunx?(\.exe)?$/i.test(basename(process.execPath));
const winRoot = winPackaged ? dirname(dirname(process.execPath)) : "";
export const DATA_DIR = process.env.VIBECODE_HOME
  ?? (winPackaged ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Vibecode") : join(homedir(), ".vibecode"));

// Where the bundled Claude Code binary and the web UI live. In the packaged .app these come from
// environment variables set by the launcher; in development they sit inside the repo.
export const CLAUDE_BIN = process.env.VIBECODE_CLAUDE_BIN ?? (winPackaged ? join(winRoot, "claude", "claude.exe") : join(
  import.meta.dir, "..", "node_modules", "@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === "win32" ? "claude.exe" : "claude",
));
export const WEB_DIR = process.env.VIBECODE_WEB ?? (winPackaged ? join(winRoot, "web") : join(import.meta.dir, "..", "web"));
