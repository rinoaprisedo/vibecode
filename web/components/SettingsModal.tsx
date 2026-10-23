import { useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { LoginFlow } from "./LoginFlow";
import { ACCOUNT_COLORS, accountColor, type Account } from "./AccountMenu";
import { applyTheme, useTheme } from "../lib/theme";

// Settings → Accounts: add several Claude subscriptions and sign each in or out.
export function SettingsModal({ accounts, refresh, onClose }: { accounts: Account[]; refresh: () => void; onClose: () => void }) {
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const theme = useTheme();

  const run = (fn: () => Promise<unknown>) => fn().then(refresh).catch((e) => setError(e.message));
  const add = () => run(async () => { const a = await api<Account>("/api/accounts", { body: {} }); setSigningIn(a.id); });
  const commitRename = () => {
    if (renaming?.name.trim()) run(() => api(`/api/accounts/${renaming.id}`, { method: "PATCH", body: { name: renaming.name } }));
    setRenaming(null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings">
        <div className="modal-head">
          <h3>Settings</h3>
          <button className="g-icon" style={{ visibility: "visible" }} onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="set-sec">
            <div className="set-sec-head"><h4>Appearance</h4><p className="muted">Theme of the whole app.</p></div>
            <div className="theme-switch" role="group" aria-label="Theme">
              <button className={theme === "dark" ? "on" : ""} onClick={() => applyTheme("dark")}><Icon name="moon" size={14} /> Dark</button>
              <button className={theme === "light" ? "on" : ""} onClick={() => applyTheme("light")}><Icon name="sun" size={14} /> Light</button>
            </div>
          </section>

          <section className="set-sec">
            <div className="set-sec-head">
              <h4>Claude accounts</h4>
              <p className="muted">Each account keeps its own sign-in. Pick which one a chat uses from the account button above the message box.</p>
            </div>
            {error && <div className="err">{error}</div>}
            {accounts.map((a) => (
              <div key={a.id} className="acc">
                <div className="acc-row">
                  <span className="acc-ico" style={{ color: accountColor(accounts, a.id) }}><Icon name="user" size={16} /></span>
                  <div className="acc-main">
                    {renaming?.id === a.id
                      ? <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: a.id, name: e.target.value })}
                          onBlur={commitRename} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }} />
                      : <b className="acc-name" title="Click to rename" onClick={() => setRenaming({ id: a.id, name: a.name })}>{a.name}</b>}
                    <small className={a.loggedIn ? "ok" : "off"}>{a.loggedIn ? `Signed in · ${a.email ?? a.method}` : "Not signed in"}</small>
                  </div>
                  {a.id !== "default" && <button className="danger acc-remove" title="Remove account" onClick={() => run(() => api(`/api/accounts/${a.id}`, { method: "DELETE" }))}><Icon name="x" size={13} /></button>}
                </div>
                <div className="acc-foot">
                  <div className="acc-colorrow">
                    <span className="acc-label">Colour</span>
                    <div className="acc-colors" role="group" aria-label="Account colour">
                      {ACCOUNT_COLORS.map((c) => (
                        <button key={c} className={"swatch" + (accountColor(accounts, a.id).toLowerCase() === c ? " on" : "")} style={{ background: c }} title={c}
                          onClick={() => run(() => api(`/api/accounts/${a.id}`, { method: "PATCH", body: { color: c } }))} />
                      ))}
                    </div>
                  </div>
                  <div className="acc-actions">
                    <button onClick={() => setSigningIn(signingIn === a.id ? null : a.id)}>{a.loggedIn ? "Switch login" : "Sign in"}</button>
                    {a.loggedIn && <button onClick={() => run(() => api(`/api/accounts/${a.id}/logout`, { body: {} }))}>Sign out</button>}
                  </div>
                </div>
                {signingIn === a.id && (
                  <div className="acc-login">
                    <LoginFlow account={a.id} onDone={() => { setSigningIn(null); refresh(); }} onChanged={refresh} />
                  </div>
                )}
              </div>
            ))}
            <button className="primary add-acc" onClick={add}><Icon name="plus" size={14} /> Add account</button>
          </section>
        </div>
      </div>
    </div>
  );
}
