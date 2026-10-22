import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { connect, send } from "../lib/api";
import { getTheme } from "../lib/theme";

const TERM_THEME = {
  dark: { background: "#1f1f1f", foreground: "#e4e4e4", cursor: "#d97757", selectionBackground: "#4a3a33" },
  light: { background: "#ffffff", foreground: "#1f1f1f", cursor: "#c0562f", selectionBackground: "#f0d9ce", black: "#1f1f1f", brightBlack: "#6f6f6f", white: "#d4d4d4", brightWhite: "#ffffff" },
};

// One xterm.js instance bound to a server-side PTY identified by `id`.
export function TerminalView({ id, project, active, onExit }: { id: string; project: string; active: boolean; onExit: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | undefined>(undefined);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const term = new XTerm({
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 12.5, cursorBlink: true,
      theme: TERM_THEME[getTheme()],
    });
    const addon = new FitAddon();
    fit.current = addon;
    term.loadAddon(addon);
    term.open(host.current!);
    addon.fit();

    const conn = connect((m) => {
      if (m.id !== id) return;
      if (m.type === "term-data") term.write(m.data);
      else if (m.type === "term-exit") onExitRef.current(id);
    });
    send({ type: "term-open", id, project, cols: term.cols, rows: term.rows });
    const input = term.onData((data) => send({ type: "term-input", id, data }));
    const resize = term.onResize(({ cols, rows }) => send({ type: "term-resize", id, cols, rows }));
    const ro = new ResizeObserver(() => host.current?.offsetParent && addon.fit());
    ro.observe(host.current!);

    const restyle = () => { term.options.theme = TERM_THEME[getTheme()]; };
    window.addEventListener("themechange", restyle);
    return () => {
      window.removeEventListener("themechange", restyle);
      ro.disconnect(); input.dispose(); resize.dispose(); conn.close();
      send({ type: "term-close", id });
      term.dispose();
    };
  }, [id]);

  useEffect(() => { if (active) fit.current?.fit(); }, [active]);

  return <div className="term-host" ref={host} style={{ display: active ? "block" : "none" }} />;
}
