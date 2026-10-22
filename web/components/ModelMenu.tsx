import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

type Model = { value: string; displayName: string; description: string };

// Picks the model for the next messages; the list comes from the signed-in account.
export function ModelMenu({ value, onChange, account }: { value: string; onChange: (model: string) => void; account: string }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<Model[] | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load on mount so the button can show the display name of the saved model.
  useEffect(() => { setFailed(false); api<Model[]>(`/api/models?account=${account}`).then(setModels).catch(() => setFailed(true)); }, [account]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const current = models?.find((m) => m.value === value);
  const label = !value ? "Default" : current?.displayName ?? value;

  return (
    <div className="modemenu" ref={ref}>
      {open && (
        <div className="menu mmenu">
          <div className="menu-head"><span>Model</span></div>
          {!models && !failed && <div className="muted">Loading…</div>}
          {failed && <div className="err">Could not load models</div>}
          {models?.map((m) => (
            <div key={m.value} className={"mode" + (m.value === value ? " on" : "")}
              onClick={() => { onChange(m.value === "default" ? "" : m.value); setOpen(false); }}>
              <span className="txt"><b>{m.displayName}</b><small>{m.description}</small></span>
              {(m.value === value || (!value && m.value === "default")) && <Icon name="check" size={16} className="check" />}
            </div>
          ))}
        </div>
      )}
      <button className="modebtn" onClick={() => setOpen(!open)} title="Model"><Icon name="sparkle" size={14} /> {label} <Icon name="chevronDown" size={12} /></button>
    </div>
  );
}
