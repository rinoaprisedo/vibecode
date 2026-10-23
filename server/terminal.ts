import { dockerBin, dockerEnv, isContainerRef } from "./docker";

type Send = (msg: unknown) => void;

// PTY-backed shells, one set per WebSocket; output is streamed to the UI as text.
export function makeTerminals(send: Send) {
  const shells = new Map<string, ReturnType<typeof Bun.spawn>>();

  const close = (id: string) => {
    shells.get(id)?.kill();
    shells.delete(id);
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
        : [process.env.SHELL ?? "/bin/zsh", "-l"];
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
    input: (id: string, data: string) => shells.get(id)?.terminal?.write(data),
    resize: (id: string, cols: number, rows: number) => shells.get(id)?.terminal?.resize(cols, rows),
    close,
    closeAll: () => [...shells.keys()].forEach(close),
  };
}
