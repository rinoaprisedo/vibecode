type Send = (msg: unknown) => void;

// PTY-backed shells, one set per WebSocket; output is streamed to the UI as text.
export function makeTerminals(send: Send) {
  const shells = new Map<string, ReturnType<typeof Bun.spawn>>();

  const close = (id: string) => {
    shells.get(id)?.kill();
    shells.delete(id);
  };

  return {
    open(id: string, root: string, cols: number, rows: number) {
      close(id);
      const dec = new TextDecoder();
      const proc = Bun.spawn([process.env.SHELL ?? "/bin/zsh", "-l"], {
        cwd: root,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
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
