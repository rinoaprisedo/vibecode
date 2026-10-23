import { useEffect, useRef, useState } from "react";
import { api, connect } from "../lib/api";
import { Icon } from "./Icon";

type Boilerplate = { id: string; name: string; description: string; repo: string; tags: string[] };
type Check = { ok: boolean; target: string; error?: string };
type Run =
  | { state: "running"; phase: "clone" | "git" | "open"; percent: number; label: string }
  | { state: "done"; root: string }
  | { state: "error"; message: string };

const STEPS = ["Template", "Location", "Create"];
const LAST_PARENT = "vibecode.boilerplateParent";
const short = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

// Create project → From boilerplate. Three steps: pick a template, choose where it goes, watch it get made.
export function BoilerplateWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<Boilerplate[]>([]);
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [fresh, setFresh] = useState(true);
  const [check, setCheck] = useState<Check | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [loadError, setLoadError] = useState("");
  const job = useRef("");
  const bp = items.find((b) => b.id === picked);

  useEffect(() => {
    api<{ items: Boilerplate[]; defaultParent: string }>("/api/boilerplate").then((r) => {
      setItems(r.items);
      setPicked(r.items[0]?.id ?? "");
      setName(r.items[0] ? `my-${r.items[0].id}` : "");
      let last = ""; try { last = localStorage.getItem(LAST_PARENT) ?? ""; } catch {}
      setParent(last || r.defaultParent);
    }).catch((e) => setLoadError(e.message));
  }, []);

  // Live check of "location + name" while on step 2.
  useEffect(() => {
    if (step !== 1 || !parent) return;
    let alive = true;
    const t = setTimeout(() => {
      api<Check>(`/api/boilerplate/check?parent=${encodeURIComponent(parent)}&name=${encodeURIComponent(name.trim())}`)
        .then((c) => alive && setCheck(c)).catch(() => {});
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [step, parent, name]);

  // Progress events for our job.
  useEffect(() => {
    const c = connect((m) => {
      if (m.type !== "boilerplate" || m.job !== job.current) return;
      if (m.phase === "clone") setRun({ state: "running", phase: "clone", percent: m.percent, label: m.label });
      else if (m.phase === "git") setRun({ state: "running", phase: "git", percent: 100, label: m.label });
      else if (m.phase === "done") { setRun({ state: "done", root: m.root }); onCreated(m.id); }
      else if (m.phase === "error") setRun({ state: "error", message: m.message });
      else if (m.phase === "cancelled") { setRun(null); setStep(1); }
    });
    return () => { c.close(); };
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && step !== 2) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [step]);

  const browse = () => api<{ path?: string }>("/api/boilerplate/pick", { body: {} }).then((r) => r.path && setParent(r.path)).catch(() => {});

  const create = async () => {
    setStep(2);
    setRun({ state: "running", phase: "clone", percent: 0, label: "Starting" });
    try {
      const r = await api<{ job: string }>("/api/boilerplate/create", { body: { id: picked, parent, name: name.trim(), fresh } });
      job.current = r.job;
      try { localStorage.setItem(LAST_PARENT, parent); } catch {}
    } catch (e: any) { setRun({ state: "error", message: e.message }); }
  };
  const cancel = () => { if (job.current) api("/api/boilerplate/cancel", { body: { job: job.current } }).catch(() => {}); };

  const running = step === 2 && run?.state === "running";
  const canCreate = !!bp && !!name.trim() && !!parent && check?.ok === true;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal bp">
        <div className="modal-head">
          <h3>Create from boilerplate</h3>
          {!running && <button className="g-icon" style={{ visibility: "visible" }} onClick={onClose}><Icon name="x" size={16} /></button>}
        </div>

        <ol className="bp-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step || run?.state === "done" ? "done" : i === step ? "on" : ""}>
              <span className="bp-dot">{i < step || run?.state === "done" ? <Icon name="check" size={12} /> : i + 1}</span>
              <span className="bp-lbl">{s}</span>
            </li>
          ))}
        </ol>

        <div className="modal-body bp-body">
          {loadError && <div className="err">{loadError}</div>}

          {step === 0 && (
            <>
              <p className="bp-intro">Start from a ready-made project. Pick a template to continue.</p>
              <div className="bp-cards" role="radiogroup">
                {items.map((b) => (
                  <button key={b.id} role="radio" aria-checked={picked === b.id} className={"bp-card" + (picked === b.id ? " on" : "")}
                    onClick={() => { setPicked(b.id); setName(`my-${b.id}`); }}>
                    <span className="bp-ico"><Icon name="box" size={20} /></span>
                    <span className="bp-ctx">
                      <b>{b.name}</b>
                      <span className="bp-desc">{b.description}</span>
                      <span className="bp-tags">{b.tags.map((t) => <i key={t}>{t}</i>)}</span>
                      <span className="bp-repo">{b.repo.replace(/^https:\/\//, "").replace(/\.git$/, "")}</span>
                    </span>
                    <span className="bp-radio">{picked === b.id && <Icon name="check" size={13} />}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <label className="bp-field">
                <span className="bp-flabel">Project name</span>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" spellCheck={false}
                  onKeyDown={(e) => e.key === "Enter" && canCreate && create()} />
              </label>
              <div className="bp-field">
                <span className="bp-flabel">Location</span>
                <div className="bp-path">
                  <input value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} placeholder="/Users/you/Projects" />
                  <button onClick={browse}><Icon name="folderOpen" size={14} /> Browse…</button>
                </div>
              </div>
              <div className={"bp-preview" + (check ? (check.ok ? " ok" : " bad") : "")}>
                <span className="bp-pico"><Icon name={check?.ok === false ? "x" : "folder"} size={15} /></span>
                <span className="bp-ptxt">
                  {check?.ok === false ? <>{check.error}</> : <>Will be created at<b>{short(check?.target ?? parent)}</b></>}
                </span>
              </div>
              <label className="bp-opt">
                <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
                <span>
                  <b>Start with a fresh git history</b>
                  <small>Your project gets its own repository with a single first commit, not linked to {bp?.name}'s GitHub repo. Turn off to keep the original history and remote.</small>
                </span>
              </label>
            </>
          )}

          {step === 2 && run && <Progress run={run} name={name.trim()} bp={bp} fresh={fresh} />}
        </div>

        <div className="bp-foot">
          {step === 0 && <><span className="bp-hint">Step 1 of 3</span><span className="bp-btns"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!bp} onClick={() => setStep(1)}>Next</button></span></>}
          {step === 1 && <><button onClick={() => setStep(0)}>Back</button><span className="bp-btns"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!canCreate} onClick={create}>Create project</button></span></>}
          {step === 2 && run?.state === "running" && <><span className="bp-hint">Please keep this window open.</span><button onClick={cancel}>Cancel</button></>}
          {step === 2 && run?.state === "error" && <><button onClick={() => { setRun(null); setStep(1); }}>Back</button><button className="primary" onClick={create}>Try again</button></>}
          {step === 2 && run?.state === "done" && <><span className="bp-hint ok">Opened in the project list.</span><button className="primary" onClick={onClose}>Start coding</button></>}
        </div>
      </div>
    </div>
  );
}

function Progress({ run, name, bp, fresh }: { run: Run; name: string; bp?: Boilerplate; fresh: boolean }) {
  const phase = run.state === "running" ? run.phase : run.state === "done" ? "open" : "clone";
  const rows = [
    { key: "clone", title: `Download ${bp?.name ?? "template"}`, sub: run.state === "running" && run.phase === "clone" ? `${run.label} · ${run.percent}%` : "Files copied to your folder" },
    ...(fresh ? [{ key: "git", title: "Set up git", sub: "Fresh repository with a first commit" }] : []),
    { key: "open", title: "Open project", sub: `Add “${name}” to your project list` },
  ];
  const order = rows.map((r) => r.key);
  const at = order.indexOf(phase);
  const failed = run.state === "error";
  return (
    <div className="bp-prog">
      {run.state === "done" && <div className="bp-banner ok"><Icon name="check" size={18} /><span><b>{name} is ready</b><small>{run.root.replace(/^\/Users\/[^/]+/, "~")}</small></span></div>}
      {failed && <div className="bp-banner bad"><Icon name="x" size={18} /><span><b>Could not create the project</b><small>{run.message}</small></span></div>}
      <ul className="bp-rows">
        {rows.map((r, i) => {
          const st = run.state === "done" ? "done" : failed ? (i < at ? "done" : i === at ? "fail" : "wait") : i < at ? "done" : i === at ? "run" : "wait";
          return (
            <li key={r.key} className={st}>
              <span className="bp-rico">{st === "done" ? <Icon name="check" size={13} /> : st === "run" ? <span className="spin" /> : st === "fail" ? <Icon name="x" size={13} /> : <i />}</span>
              <span className="bp-rtxt">
                <b>{r.title}</b><small>{st === "wait" ? "Waiting" : st === "fail" ? "Stopped here" : r.sub}</small>
                {r.key === "clone" && st === "run" && run.state === "running" && (
                  <span className="bp-bar"><span style={{ width: run.percent + "%" }} /><em>{run.percent}%</em></span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
