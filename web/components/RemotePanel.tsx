import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import type { Account } from "./AccountMenu";

export type RemoteState = {
  project: string; status: "starting" | "connected" | "error" | "stopped"; account: string;
  url?: string; session?: string; error?: string; untrusted?: boolean; trustCommand?: string;
};

// Remote Control for the focused project: lets the Claude mobile app / claude.ai/code work in this folder.
export function RemotePanel({ project, accounts, state }: {
  project: { id: string; name: string }; accounts: Account[]; state?: RemoteState;
}) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(() => { try { return localStorage.getItem("vibecode.account") ?? "default"; } catch { return "default"; } });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const status = state?.status ?? "stopped";
  const live = status === "connected" || status === "starting";
  const call = (path: string, body: object = {}) => {
    setBusy(true);
    return api(path, { body, project: project.id }).catch(() => {}).finally(() => setBusy(false));
  };
  const copy = (what: string, text?: string) =>
    text && navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(""), 1500); });
  const acc = accounts.find((a) => a.id === (state?.account ?? account));

  return (
    <div className="remote" ref={ref}>
      <button className={"modebtn iconbtn" + (status === "connected" ? " live" : "")} onClick={() => setOpen(!open)}
        title={status === "connected" ? "Remote Control: connected" : "Remote Control (Claude app on your phone)"}>
        <Icon name="phone" size={16} />{status === "connected" && <span className="r-dot" />}
      </button>
      {open && (
        <div className="menu rmenu">
          <div className="menu-head"><span>Remote Control</span><span className="muted">{project.name}</span></div>
          <p className="r-note">Lets the <b>Claude app</b> (Android/iOS) or claude.ai/code work in this folder, using this Mac. It opens its own session there, separate from the chat tabs in this IDE. File changes it makes show up here live.</p>

          {status === "connected" && (
            <div className="r-box ok">
              <div className="r-line"><span className="r-dot" /> Connected{acc ? <small>{acc.name}</small> : null}</div>
              <small>Open the <b>Code</b> tab in the Claude app, or:</small>
              <div className="r-actions">
                <a href={state?.url} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Open claude.ai/code</a>
                <button onClick={() => copy("link", state?.url)}><Icon name="copy" size={13} /> {copied === "link" ? "Copied" : "Copy link"}</button>
              </div>
            </div>
          )}
          {status === "starting" && <div className="r-box"><div className="r-line"><span className="r-dot pulse" /> Connecting…</div></div>}
          {status === "error" && (
            <div className="r-box err">
              {state?.untrusted ? (
                <>
                  <small>Claude Code only runs in folders you've trusted, and that choice is yours. Run this once in Terminal, accept the trust prompt, quit it (Ctrl+C twice), then press Start again:</small>
                  <code className="r-cmd">{state.trustCommand}</code>
                  <div className="r-actions"><button onClick={() => copy("cmd", state.trustCommand)}><Icon name="copy" size={13} /> {copied === "cmd" ? "Copied" : "Copy command"}</button></div>
                </>
              ) : <small className="r-err">{state?.error}</small>}
            </div>
          )}

          <div className="menu-sep" />
          {!live ? (
            <div className="r-foot">
              <select value={account} onChange={(e) => setAccount(e.target.value)} title="Claude account (use the same one as in the app)">
                {accounts.filter((a) => a.loggedIn).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button className="primary" disabled={busy} onClick={() => call("/api/remote/start", { account })}>Start</button>
            </div>
          ) : (
            <div className="r-foot">
              <span className="muted" style={{ padding: 0, flex: 1 }}>Stops when the IDE server stops.</span>
              <button disabled={busy} onClick={() => call("/api/remote/stop")}>Stop</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
