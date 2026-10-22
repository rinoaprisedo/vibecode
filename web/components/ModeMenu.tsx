import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export const MODES = [
  { id: "manual", icon: "hand" as IconName, label: "Manual", desc: "Claude will ask for approval before making each edit" },
  { id: "edit", icon: "code" as IconName, label: "Edit automatically", desc: "Claude will edit files without asking; other actions still ask" },
  { id: "plan", icon: "plan" as IconName, label: "Plan", desc: "Claude will explore the code and present a plan before editing" },
  { id: "auto", icon: "zap" as IconName, label: "Auto", desc: "Claude will approve actions that pass a safety check and pause for anything risky" },
] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ModeId = (typeof MODES)[number]["id"];
export type Effort = (typeof EFFORTS)[number];
export type Settings = { mode: ModeId; effort: Effort; ultracode: boolean; model: string };

export const nextMode = (m: ModeId): ModeId => MODES[(MODES.findIndex((x) => x.id === m) + 1) % MODES.length].id;

// Popup like the VS Code extension: modes, effort dots, ultracode switch.
export function ModeMenu({ value, onChange }: { value: Settings; onChange: (s: Settings) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = MODES.find((m) => m.id === value.mode)!;

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="modemenu" ref={ref}>
      {open && (
        <div className="menu">
          <div className="menu-head"><span>Modes</span><span className="muted">⇧ + tab to switch</span></div>
          {MODES.map((m) => (
            <div key={m.id} className={"mode" + (m.id === value.mode ? " on" : "")}
              onClick={() => { onChange({ ...value, mode: m.id }); setOpen(false); }}>
              <span className="ico"><Icon name={m.icon} size={18} /></span>
              <span className="txt"><b>{m.label}</b><small>{m.desc}</small></span>
              {m.id === value.mode && <Icon name="check" size={16} className="check" />}
            </div>
          ))}
          <div className="menu-sep" />
          <div className="mode-row">
            <span>Effort <span className="muted">({value.effort})</span></span>
            <span className="dots">
              {EFFORTS.map((e) => (
                <span key={e} className={"dot" + (e === value.effort ? " on" : "")} title={e}
                  onClick={() => onChange({ ...value, effort: e })} />
              ))}
            </span>
          </div>
          <div className="mode-row">
            <span>Ultracode</span>
            <span className={"switch" + (value.ultracode ? " on" : "")}
              onClick={() => onChange({ ...value, ultracode: !value.ultracode })}><i /></span>
          </div>
        </div>
      )}
      <button className="modebtn iconbtn" onClick={() => setOpen(!open)} title={`Mode: ${cur.label}`}><Icon name={cur.icon} size={16} /></button>
    </div>
  );
}
