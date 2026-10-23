import { useCallback, useEffect, useState } from "react";
import { api, connect } from "../lib/api";
import { Icon } from "./Icon";

export type TunnelInfo = { project: string; port: number; state: "starting" | "live" | "error"; url?: string; error?: string };
type Port = { port: number; process: string; pid: number; inProject: boolean };
type Status = { installed: boolean; version: string; canInstall: boolean; scan: boolean };

const mb = (n: number) => (n / 1048576).toFixed(1);
const STEP: Record<string, string> = { downloading: "Downloading cloudflared", unpacking: "Unpacking", verifying: "Checking that it runs", done: "Done" };

// Download progress: a real percentage while bytes arrive, a moving bar for the quick steps after.
function InstallBar({ dl }: { dl: { phase: string; received: number; total: number } }) {
  const known = dl.phase === "downloading" && dl.total > 0;
  const pct = dl.phase === "downloading" ? (known ? Math.min(100, (dl.received / dl.total) * 100) : 0) : 100;
  return (
    <div className="tn-progress">
      <div className="tn-ptop">
        <span>{STEP[dl.phase] ?? dl.phase}…</span>
        <b>{dl.phase === "downloading" ? (known ? `${mb(dl.received)} / ${mb(dl.total)} MB · ${Math.round(pct)}%` : `${mb(dl.received)} MB`) : ""}</b>
      </div>
      <div className="tn-track"><div className={"tn-fill" + (known || dl.phase !== "downloading" ? "" : " indet") + (dl.phase !== "downloading" ? " busy" : "")} style={{ width: (known || dl.phase !== "downloading" ? pct : 35) + "%" }} /></div>
    </div>
  );
}

// Popup for one project: pick a running port, get a public https link to it (Cloudflare quick tunnel, no account).
export function TunnelModal({ project, tunnels, onClose }: { project: { id: string; name: string }; tunnels: TunnelInfo[]; onClose: () => void }) {
  const call = <T = any,>(path: string, body?: unknown) => api<T>(`/api/tunnel/${path}`, { body, project: project.id });
  const [status, setStatus] = useState<Status | null>(null);
  const [ports, setPorts] = useState<Port[] | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dl, setDl] = useState<{ phase: string; received: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const [copied, setCopied] = useState("");
  const [others, setOthers] = useState(false);

  useEffect(() => { call<Status>("status").then(setStatus).catch((e) => setError(e.message)); }, []);
  const scan = useCallback(() => { call<Port[]>("ports").then(setPorts).catch(() => setPorts([])); }, [project.id]);
  useEffect(() => {
    scan();
    const t = setInterval(() => { if (!document.hidden) scan(); }, 3000);
    return () => clearInterval(t);
  }, [scan]);
  useEffect(() => {
    const conn = connect((m) => { if (m.type === "tunnel-install") setDl({ phase: m.phase, received: m.received, total: m.total }); });
    return () => { conn.close(); };
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const mine = tunnels.filter((t) => t.project === project.id);
  const of = (port: number) => mine.find((t) => t.port === port);
  const start = (port: number) => { setError(""); call("start", { port }).catch((e) => setError(e.message)); };
  const stop = (port: number) => call("stop", { port }).catch((e) => setError(e.message));
  const install = () => {
    setInstalling(true); setError(""); setDl({ phase: "downloading", received: 0, total: 0 });
    call<Status>("install", {}).then(setStatus).catch((e) => setError(e.message)).finally(() => { setInstalling(false); setDl(null); });
  };
  const copy = (url: string) => navigator.clipboard?.writeText(url).then(() => { setCopied(url); setTimeout(() => setCopied(""), 1500); });

  const inProject = (ports ?? []).filter((p) => p.inProject);
  const rest = (ports ?? []).filter((p) => !p.inProject);
  // a tunnel whose port stopped listening (or that was added by hand) still needs a row so it can be stopped
  const known = new Set((ports ?? []).map((p) => p.port));
  const orphans = mine.filter((t) => !known.has(t.port));
  const manualPort = Number(manual);
  const manualOk = Number.isInteger(manualPort) && manualPort >= 1 && manualPort <= 65535;

  const row = (port: number, label: string, tag?: string) => {
    const t = of(port);
    return (
      <div key={port} className={"tn-row" + (t?.state === "live" ? " live" : "")}>
        <div className="tn-main">
          <span className="tn-port">:{port}</span>
          <span className="tn-proc">{label}</span>
          {tag && <span className="dk-pill acc">{tag}</span>}
          <span style={{ flex: 1 }} />
          {!t && <button className="primary" disabled={!status?.installed} onClick={() => start(port)}><Icon name="play" size={12} /> Start tunnel</button>}
          {t?.state === "starting" && <><span className="tn-starting"><span className="dk-spin" /> Connecting…</span><button onClick={() => stop(port)}>Cancel</button></>}
          {t?.state === "live" && <button className="danger" onClick={() => stop(port)}><Icon name="stop" size={12} /> Stop</button>}
          {t?.state === "error" && <button onClick={() => start(port)}><Icon name="rotate" size={12} /> Retry</button>}
        </div>
        {t?.state === "live" && t.url && (
          <div className="tn-link">
            <Icon name="globe" size={14} />
            <a href={t.url} target="_blank" rel="noreferrer" title="Open in browser">{t.url}</a>
            <button className="dk-mini" onClick={() => copy(t.url!)}><Icon name="copy" size={11} /> {copied === t.url ? "Copied" : "Copy"}</button>
            <a className="dk-mini tn-open" href={t.url} target="_blank" rel="noreferrer"><Icon name="external" size={11} /> Open</a>
          </div>
        )}
        {t?.state === "error" && <div className="tn-err">{t.error}</div>}
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tunnel">
        <div className="modal-head">
          <h3><Icon name="globe" size={15} /> Public link · {project.name}</h3>
          <button className="g-icon" style={{ visibility: "visible" }} onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="sec-note">Pick a port that is running in this project and get a public <b>https</b> link to it, through a free Cloudflare quick tunnel. No account needed.</p>

          {status && !status.installed && (
            <div className="tn-install">
              <div>
                <b>cloudflared is needed</b>
                <small>{status.canInstall ? "A small helper program (about 40 MB) from Cloudflare's official releases, saved inside Vibecode's data folder." : "Install it first, for example: brew install cloudflared"}</small>
              </div>
              {status.canInstall && <button className="primary" disabled={installing} onClick={install}>{installing ? <><span className="dk-spin" /> Installing…</> : <><Icon name="download" size={13} /> Download</>}</button>}
              {installing && dl && <InstallBar dl={dl} />}
            </div>
          )}
          {error && <div className="err">{error}</div>}

          <div className="tn-sec">In this project</div>
          {ports === null ? <div className="muted">Looking for running ports…</div> : (<>
            {inProject.map((p) => row(p.port, p.process, "this project"))}
            {orphans.map((t) => row(t.port, "not listening"))}
            {!inProject.length && !orphans.length && (
              <div className="tn-empty">
                <Icon name="play" size={22} />
                <p>No running server found in <b>{project.name}</b>.</p>
                <small>Start your dev server (for example from a terminal template), then it shows up here.</small>
              </div>
            )}
            {rest.length > 0 && (
              <>
                <button className="tn-toggle" onClick={() => setOthers(!others)}><Icon name={others ? "chevronDown" : "chevronRight"} size={13} /> Other ports on this computer ({rest.length})</button>
                {others && rest.map((p) => row(p.port, p.process))}
              </>
            )}
          </>)}

          <form className="tn-manual" onSubmit={(e) => { e.preventDefault(); if (manualOk) { start(manualPort); setManual(""); } }}>
            <input inputMode="numeric" placeholder="Or type a port, e.g. 3000" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, "").slice(0, 5))} />
            <button disabled={!manualOk || !status?.installed}><Icon name="play" size={12} /> Start</button>
          </form>

          <div className="tn-warn">
            <Icon name="bell" size={14} />
            <span>Anyone who has the link can reach that port, with no password. Stop the tunnel when you are done. The link changes every time, and all tunnels stop when Vibecode closes.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
