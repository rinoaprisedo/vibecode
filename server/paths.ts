import { join } from "node:path";
import { homedir } from "node:os";

// Where settings, logins, chats and the list of open folders are kept. The packaged app points this at its own
// folder (~/Library/Application Support/Vibecode) so a fresh install starts empty and never reuses a developer's state.
export const DATA_DIR = process.env.VIBECODE_HOME ?? join(homedir(), ".vibecode");

// Where the bundled Claude Code binary and the web UI live. In the packaged .app these come from
// environment variables set by the launcher; in development they sit inside the repo.
export const CLAUDE_BIN = process.env.VIBECODE_CLAUDE_BIN ?? join(
  import.meta.dir, "..", "node_modules", "@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`, "claude",
);
export const WEB_DIR = process.env.VIBECODE_WEB ?? join(import.meta.dir, "..", "web");
