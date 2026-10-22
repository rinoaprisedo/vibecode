
import { CLAUDE_BIN as bin } from "./paths";
const env = (dir: string) => ({ ...process.env, CLAUDE_CONFIG_DIR: dir, BROWSER: "none" });

export async function authStatus(dir: string): Promise<{ loggedIn: boolean; method: string; email?: string }> {
  if (process.env.ANTHROPIC_API_KEY) return { loggedIn: true, method: "ANTHROPIC_API_KEY" };
  const p = Bun.spawn([bin, "auth", "status"], { env: env(dir), stdout: "pipe", stderr: "ignore" });
  try {
    const s = JSON.parse(await new Response(p.stdout).text());
    return { loggedIn: !!s.loggedIn, method: s.authMethod, email: s.email };
  } catch {
    return { loggedIn: false, method: "none" };
  }
}

type Send = (msg: unknown) => void;

// One login attempt at a time per socket: emits the OAuth URL, accepts the pasted code.
export function makeLogin(send: Send) {
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  const stop = () => { proc?.kill(); proc = null; };

  return {
    stop,
    start(mode: "claudeai" | "console", account: string, dir: string) {
      stop();
      const p = Bun.spawn([bin, "auth", "login", `--${mode}`], {
        env: env(dir), stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      proc = p;
      let sentUrl = false;
      const read = async (s: ReadableStream) => {
        const dec = new TextDecoder();
        for await (const chunk of s) {
          const text = dec.decode(chunk);
          const url = text.match(/https:\/\/\S+/)?.[0];
          if (url && !sentUrl) { sentUrl = true; send({ type: "login-url", account, url });
            if (process.env.NO_OPEN !== "1") Bun.spawn(["open", url]); }
        }
      };
      void read(p.stdout as ReadableStream);
      void read(p.stderr as ReadableStream);
      void p.exited.then(async (code) => {
        if (proc !== p) return; // cancelled or superseded
        proc = null;
        const status = await authStatus(dir);
        send({ type: "login-result", account, ok: code === 0 && status.loggedIn, status });
      });
    },
    submitCode(code: string) {
      const stdin = proc?.stdin as import("bun").FileSink | undefined;
      stdin?.write(code.trim() + "\n");
      stdin?.flush();
    },
    async logout(dir: string) {
      stop();
      await Bun.spawn([bin, "auth", "logout"], { env: env(dir), stdout: "ignore", stderr: "ignore" }).exited;
    },
  };
}
