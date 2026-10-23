import { useEffect, useRef, useState } from "react";
import { TerminalView } from "./Terminal";
import { Icon } from "./Icon";

let counter = 0;
const newId = () => `t${++counter}`;

type Term = { id: string; project: string; name: string; command?: string };
export type TermRun = { seq: number; title: string; command: string };

// Terminals from every open project live here; a new one starts in the focused project's folder.
export function TerminalPanel({ project, width, onClose, run }: { project: { id: string; name: string }; width?: number; onClose: () => void; run?: TermRun }) {
  const make = (r?: TermRun): Term => ({ id: newId(), project: project.id, name: r ? r.title : project.name, command: r?.command });
  const [terms, setTerms] = useState<Term[]>(() => [make(run)]);
  const [active, setActive] = useState(terms[0].id);
  // A template run asks for a fresh tab that executes its command; the one that opened the panel is handled above.
  const handled = useRef(run?.seq);
  useEffect(() => {
    if (!run || run.seq === handled.current) return;
    handled.current = run.seq;
    const t = make(run);
    setTerms((x) => [...x, t]);
    setActive(t.id);
  }, [run?.seq]);

  const add = () => { const t = make(); setTerms((x) => [...x, t]); setActive(t.id); };
  const close = (id: string) => {
    const rest = terms.filter((x) => x.id !== id);
    if (!rest.length) return onClose();
    setTerms(rest);
    if (active === id) setActive(rest[rest.length - 1].id);
  };
  // Focusing another project brings its terminal forward, if it has one.
  useEffect(() => {
    const t = terms.find((x) => x.project === project.id);
    if (t) setActive(t.id);
  }, [project.id]);

  return (
    <div className="terminal" style={width ? { width, flex: "none" } : undefined}>
      <div className="term-tabs">
        {terms.map((t) => (
          <div key={t.id} className={"term-tab" + (t.id === active ? " on" : "")} onClick={() => setActive(t.id)} title={`Terminal in ${t.name}`}>
            {t.name}
            <span className="x" onClick={(e) => { e.stopPropagation(); close(t.id); }}><Icon name="x" size={12} /></span>
          </div>
        ))}
        <button className="g-icon" style={{ visibility: "visible" }} title="New terminal" onClick={add}><Icon name="plus" size={14} /></button>
        <span style={{ flex: 1 }} />
        <button className="g-icon" style={{ visibility: "visible" }} title="Hide terminal" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div className="term-body">
        {terms.map((t) => <TerminalView key={t.id} id={t.id} project={t.project} active={t.id === active} onExit={close} command={t.command} />)}
      </div>
    </div>
  );
}
