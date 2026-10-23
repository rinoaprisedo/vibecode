import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

// Branch switcher: filter, checkout, and create a branch from any base.
export function BranchMenu({ project, current, onDone, onError }: {
  project: string; current: string; onDone: (message?: string) => void; onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(current);
  const [dirty, setDirty] = useState(0);            // uncommitted changes, shown before switching
  const [confirm, setConfirm] = useState("");       // branch waiting for confirmation
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api<{ files: unknown[] }>("/api/git/status", { project }).then((r) => setDirty(r.files.length)).catch(() => setDirty(0));
    api<{ branches: string[] }>("/api/git/branches", { project }).then((r) => setBranches(r.branches)).catch((e) => onError(e.message));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const reset = () => { setConfirm(""); setOpen(false); setCreating(false); setName(""); setFilter(""); };
  const run = (path: string, body: object) =>
    api(path, { body, project }).then(() => {
      const target = String((body as { name: string }).name).replace(/^origin\//, "");
      reset(); onDone(path.endsWith("/branch") ? `Created and switched to branch "${target}"` : `Switched to branch "${target}"`);
    }).catch((e) => { reset(); onError(e.message); });

  return (
    <div className="branchmenu" ref={ref}>
      <button className="g-branchbtn" onClick={() => { setFrom(current); setOpen(!open); }} title="Switch branch"><Icon name="branch" size={14} /> <span>{current}</span></button>
      {open && (
        <div className="menu bmenu">
          {creating ? (
            <div className="b-create">
              <input autoFocus placeholder="New branch name" value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && run("/api/git/branch", { name: name.trim(), from })} />
              <label className="muted">Create from</label>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {[...new Set([current, ...branches])].map((b) => <option key={b}>{b}</option>)}
              </select>
              <div className="b-actions">
                <button onClick={() => setCreating(false)}>Back</button>
                <button className="primary" disabled={!name.trim()} onClick={() => run("/api/git/branch", { name: name.trim(), from })}>
                  Create & checkout
                </button>
              </div>
            </div>
          ) : (
            <>
              <input autoFocus className="b-filter" placeholder="Filter branches" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="b-item new" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> Create new branch…</div>
              <div className="b-list">
                {branches.filter((b) => b.includes(filter)).map((b) => {
                  const remote = b.startsWith("origin/");
                  const label = remote ? b.slice(7) : b;
                  if (confirm === b) return (
                    <div key={b} className="b-confirm">
                      <div><b>{label}</b>: {dirty} uncommitted change{dirty > 1 ? "s" : ""} will come along. If they conflict with that branch, the checkout is cancelled.</div>
                      <div className="b-actions">
                        <button onClick={() => setConfirm("")}>Cancel</button>
                        <button className="primary" onClick={() => run("/api/git/checkout", { name: b })}>Checkout</button>
                      </div>
                    </div>
                  );
                  return (
                    <div key={b} className={"b-item" + (b === current ? " on" : "")} title={b === current ? "Current branch" : `Checkout ${label}`}
                      onClick={() => b === current ? setOpen(false) : dirty ? setConfirm(b) : run("/api/git/checkout", { name: b })}>
                      <span className="b-name">{label}</span>
                      {remote && <em className="b-tag">remote</em>}
                      {b === current ? <Icon name="check" size={14} /> : <span className="b-co">Checkout</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
