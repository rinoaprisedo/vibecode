import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import type { Account } from "./AccountMenu";
import { MODES, type ModeId } from "./ModeMenu";

export type RemoteState = {
  project: string; status: "starting" | "connected" | "error" | "stopped"; account: string; mode?: string;
  url?: string; session?: string; error?: string; untrusted?: boolean; trustCommand?: string; root?: string; note?: string;
};

// Remote Control for the focused project: lets the Claude mobile app / claude.ai/code work in this folder.
// It runs with the account and permission mode picked for the current chat, so there is nothing to choose here.
export function RemotePanel({ project, accounts, account, mode, state }: {
  project: { id: string; name: string }; accounts: Account[]; account: string; mode: ModeId; state?: RemoteState;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false); // Stop pressed, until the server reports it is no longer running
  const [copied, setCopied] = useState("");
  const [trustOpen, setTrustOpen] = useState(false);
  const asked = useRef(false); // show the trust popup once per Start attempt
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const status = state?.status ?? "stopped";

  // Start was refused because the folder isn't trusted yet: ask the user, in a popup, like Claude Code's own dialog.
  useEffect(() => {
    if (state?.status === "error" && state.untrusted && !asked.current) { asked.current = true; setTrustOpen(true); }
  }, [state?.status, state?.untrusted]);
  const live = status === "connected" || status === "starting";
  useEffect(() => { if (!live) setStopping(false); }, [live]);
  const stop = () => { setStopping(true); call("/api/remote/stop").then(() => { if (!live) setStopping(false); }); };
  const call = (path: string, body: object = {}) => {
    setBusy(true);
    return api(path, { body, project: project.id }).catch(() => {}).finally(() => setBusy(false));
  };
  const copy = (what: string, text?: string) =>
    text && navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(""), 1500); });
  const start = () => { asked.current = false; return call("/api/remote/start", { account, mode }); };
  const modeLabel = (id?: string) => MODES.find((m) => m.id === id)?.label ?? "Manual";
  // The mode is fixed when Remote Control starts; a later change in the chat needs a restart to reach the phone.
  const stale = status === "connected" && (state?.mode ?? "manual") !== mode;
  // The user confirmed in the popup for this one folder; record it and start Remote Control again.
  const trustAndStart = async () => {
    await call("/api/remote/trust", { account: state?.account ?? account, confirmed: true });
    setTrustOpen(false);
    await start();
  };
  const acc = accounts.find((a) => a.id === (state?.account ?? account));

  return (
    <div className="remote" ref={ref}>
      <button className={"modebtn iconbtn" + (status === "connected" ? " live" : "")} onClick={() => setOpen(!open)}
        title={status === "connected" ? "Remote Control: connected" : "Remote Control (Claude app on your phone)"}>
        <Icon name="phone" size={16} />{stopping ? <span className="spin r-spin" /> : status === "connected" && <span className="r-dot" />}
      </button>
      {open && (
        <div className="menu rmenu">
          <div className="menu-head"><span>Remote Control</span><span className="muted">{project.name}</span></div>
          <p className="r-note">Lets the <b>Claude app</b> (Android/iOS) or claude.ai/code work in this folder, using this Mac. It opens its own session there, separate from the chat tabs in this IDE. File changes it makes show up here live.</p>

          {status === "connected" && !stopping && (
            <div className="r-box ok">
              <div className="r-line"><span className="r-dot" /> Connected{acc ? <small>{acc.name} · {modeLabel(state?.mode)}</small> : null}</div>
              {stale && <small>Running in <b>{modeLabel(state?.mode)}</b> mode. Stop and Start to switch to <b>{modeLabel(mode)}</b>.</small>}
              <small>Open the <b>Code</b> tab in the Claude app, or:</small>
              <div className="r-actions">
                <a href={state?.url} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Open claude.ai/code</a>
                <button onClick={() => copy("link", state?.url)}><Icon name="copy" size={13} /> {copied === "link" ? "Copied" : "Copy link"}</button>
              </div>
            </div>
          )}
          {stopping && <div className="r-box"><div className="r-line"><span className="spin" /> Stopping Remote Control…</div></div>}
          {status === "starting" && !stopping && <div className="r-box"><div className="r-line"><span className="r-dot pulse" /> Connecting…</div>{state?.note && <small>{state.note}</small>}</div>}
          {status === "error" && (
            <div className="r-box err">
              {state?.untrusted ? (
                <>
                  <small>Claude Code only runs in folders you trust. This folder isn't trusted yet.</small>
                  <div className="r-actions"><button onClick={() => setTrustOpen(true)}>Review & trust…</button></div>
                </>
              ) : <small className="r-err">{state?.error}</small>}
            </div>
          )}

          <div className="menu-sep" />
          {!live ? (
            <div className="r-foot">
              <span className="muted" style={{ padding: 0, flex: 1 }} title="The account picked for this chat (use the same one in the Claude app)">
                {acc?.name ?? account}{acc && !acc.loggedIn ? " — not signed in" : ""} · {modeLabel(mode)}
              </span>
              <button className="primary" disabled={busy || (!!acc && !acc.loggedIn)} onClick={start}>Start</button>
            </div>
          ) : (
            <div className="r-foot">
              <span className="muted" style={{ padding: 0, flex: 1 }}>Stops when the IDE server stops.</span>
              <button disabled={busy || stopping} className={stopping ? "r-stopping" : ""} onClick={stop}>{stopping ? <><span className="spin" /> Stopping…</> : "Stop"}</button>
            </div>
          )}
        </div>
      )}
      {trustOpen && createPortal(
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setTrustOpen(false)}>
          <div className="modal trust">
            <div className="modal-head"><h3>Do you trust this folder?</h3></div>
            <div className="modal-body">
              <code className="trust-path">{state?.root ?? project.name}</code>
              <p className="sec-note">
                Remote Control runs Claude Code in this folder so the Claude app on your phone can work in it.
                Claude will be able to <b>read, edit and run files here</b> (each action still follows the permission
                mode you pick). Only trust folders whose contents you trust.
              </p>
              <div className="trust-actions">
                <button onClick={() => setTrustOpen(false)}>Don't trust</button>
                <button className="primary" disabled={busy} onClick={trustAndStart}>Yes, I trust this folder</button>
              </div>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
}
