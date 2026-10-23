import { isWin, winShell } from "./platform";
import { dockerBin, dockerEnv, isContainerRef } from "./docker";

type Send = (msg: unknown) => void;

// PTY-backed shells, one set per WebSocket; output is streamed to the UI as text.
export function makeTerminals(send: Send) {
  const shells = new Map<string, ReturnType<typeof Bun.spawn>>();

  const close = (id: string) => {
    shells.get(id)?.kill();
    shells.delete(id);
  };

  // Windows has no PTY for Bun.spawn, so the shell runs over plain pipes: keystrokes are echoed and line-edited here and
  // each finished line is sent to the shell. Fine for commands and output; full-screen programs won't work.
  const lines = new Map<string, string>();
  const openPiped = (id: string, argv: string[], root: string, dec: TextDecoder) => {
    const proc = Bun.spawn(argv, { cwd: root, env: { ...process.env, TERM: "xterm-256color" }, stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true } as any);
    const pump = async (s: ReadableStream) => { for await (const chunk of s) send({ type: "term-data", id, data: dec.decode(chunk, { stream: true }).replace(/\r?\n/g, "\r\n") }); };
    void pump(proc.stdout as ReadableStream); void pump(proc.stderr as ReadableStream);
    shells.set(id, proc); lines.set(id, "");
    send({ type: "term-data", id, data: `${root}> ` });
    void proc.exited.then((code) => {
      lines.delete(id);
      if (shells.get(id) === proc) { shells.delete(id); send({ type: "term-exit", id, code }); }
    });
  };
  const typed = (id: string, data: string) => {
    const proc = shells.get(id) as any;
    if (!proc?.stdin) return false;
    let buf = lines.get(id) ?? "";
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") { send({ type: "term-data", id, data: "\r\n" }); proc.stdin.write(buf + "\n"); proc.stdin.flush?.(); buf = ""; }
      else if (ch === "\x7f" || ch === "\b") { if (buf) { buf = buf.slice(0, -1); send({ type: "term-data", id, data: "\b \b" }); } }
      else if (ch === "\x03") { buf = ""; send({ type: "term-data", id, data: "^C\r\n" }); }
      else if (ch >= " ") { buf += ch; send({ type: "term-data", id, data: ch }); }
    }
    lines.set(id, buf);
    return true;
  };

  return {
    open(id: string, root: string, cols: number, rows: number, docker?: string) {
      close(id);
      const dec = new TextDecoder();
      // `docker` names a container: open a shell inside it instead of on this machine.
      const bin = docker !== undefined && isContainerRef(docker) ? dockerBin() : null;
      if (docker !== undefined && !bin) return send({ type: "term-exit", id, code: 1 });
      const argv = bin
        ? [bin, "exec", "-it", docker!, "sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"]
        : isWin ? winShell() : [process.env.SHELL ?? "/bin/zsh", "-l"];
      if (isWin && !bin) return openPiped(id, argv, root, dec);
      const proc = Bun.spawn(argv, {
        cwd: root,
        env: { ...(bin ? dockerEnv() : process.env), TERM: "xterm-256color", COLORTERM: "truecolor" },
        terminal: {
          cols, rows,
          data: (_t, chunk) => send({ type: "term-data", id, data: dec.decode(chunk, { stream: true }) }),
        },
      });
      shells.set(id, proc);
      void proc.exited.then((code) => {
        if (shells.get(id) === proc) { shells.delete(id); send({ type: "term-exit", id, code }); }
      });
    },
    input: (id: string, data: string) => { if (isWin && typed(id, data)) return; shells.get(id)?.terminal?.write(data); },
    resize: (id: string, cols: number, rows: number) => shells.get(id)?.terminal?.resize(cols, rows),
    close,
    closeAll: () => [...shells.keys()].forEach(close),
  };
}
