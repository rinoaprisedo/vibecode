import { useEffect, useState } from "react";
import type React from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { LoginFlow } from "./LoginFlow";
import { ACCOUNT_COLORS, accountColor, type Account } from "./AccountMenu";
import { applyTheme, useTheme } from "../lib/theme";
import { comboOf, pretty, reservedCombo, setShortcuts, useShortcuts, DEFAULT_SHORTCUTS, SHORTCUT_LABELS, type AppShortcuts } from "../lib/shortcuts";

// Settings → Accounts: add several Claude subscriptions and sign each in or out.
export function SettingsModal({ accounts, refresh, onClose }: { accounts: Account[]; refresh: () => void; onClose: () => void }) {
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const theme = useTheme();
  const [autoSwitch, setAutoSwitch] = useState(() => { try { return localStorage.getItem("vibecode.autoSwitch") !== "off"; } catch { return true; } });
  const toggleAutoSwitch = () => setAutoSwitch((v) => { try { localStorage.setItem("vibecode.autoSwitch", v ? "off" : "on"); } catch {} return !v; });

  // Keyboard shortcuts: click a field and press modifier + key. Template shortcuts are read so the two never clash.
  const sc = useShortcuts();
  const [rec, setRec] = useState<keyof AppShortcuts | null>(null);
  const [scErr, setScErr] = useState("");
  const [tplKeys, setTplKeys] = useState<Record<string, string>>({});
  useEffect(() => { api<{ prompts: { title: string; shortcut?: string }[] }>("/api/templates").then((d) => setTplKeys(Object.fromEntries(d.prompts.filter((p) => p.shortcut).map((p) => [p.shortcut!, p.title])))).catch(() => {}); }, []);
  const recordKey = (name: keyof AppShortcuts) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Tab") return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { (e.target as HTMLElement).blur(); return; }
    if (e.key === "Backspace" || e.key === "Delete") { setShortcuts({ ...sc, [name]: "" }); setScErr(""); return; }
    const c = comboOf(e.nativeEvent);
    if (!c) { if (!["Control", "Alt", "Meta", "Shift"].includes(e.key)) setScErr("Use one modifier plus one letter or digit, e.g. " + pretty("Alt+1")); return; }
    if (reservedCombo(c)) { setScErr(`${pretty(c)} is already used by the app or the system. Try ${pretty("Alt+" + c.split("+")[1])}.`); return; }
    const other = (Object.keys(sc) as (keyof AppShortcuts)[]).find((k) => k !== name && sc[k] === c);
    if (other) { setScErr(`${pretty(c)} is already set for “${SHORTCUT_LABELS[other]}”.`); return; }
    if (tplKeys[c]) { setScErr(`${pretty(c)} is already set on the template “${tplKeys[c]}”.`); return; }
    setScErr(""); setShortcuts({ ...sc, [name]: c }); (e.target as HTMLElement).blur();
  };

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
            <div className="set-sec-head"><h4>Keyboard shortcuts</h4><p className="muted">Click a field, then press a modifier plus one key. Backspace turns a shortcut off. Prompt templates have their own shortcut in the template editor.</p></div>
            {scErr && <div className="err">{scErr}</div>}
            {(Object.keys(SHORTCUT_LABELS) as (keyof AppShortcuts)[]).map((k) => (
              <div key={k} className="sc-row">
                <span>{SHORTCUT_LABELS[k]}</span>
                <button type="button" data-shortcut-rec className={"tpl-sc-in" + (rec === k ? " rec" : "") + (sc[k] ? " set" : "")}
                  onFocus={() => setRec(k)} onBlur={() => setRec(null)} onKeyDown={recordKey(k)} title="Click, then press a modifier + key">
                  {rec === k ? "Press keys…" : sc[k] ? pretty(sc[k]) : "Off"}
                </button>
                <button type="button" className="g-icon" style={{ visibility: sc[k] === DEFAULT_SHORTCUTS[k] ? "hidden" : "visible" }} title="Reset to default" onClick={() => { setShortcuts({ ...sc, [k]: DEFAULT_SHORTCUTS[k] }); setScErr(""); }}><Icon name="rotate" size={13} /></button>
              </div>
            ))}
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
            <label className="auto-switch">
              <input type="checkbox" checked={autoSwitch} onChange={toggleAutoSwitch} />
              <span><b>Auto-switch when a limit is hit</b><small className="muted">If an account runs out mid-chat, move to another signed-in account that still has room and continue the work.</small></span>
            </label>
          </section>

          <footer className="set-about">
            <b>Vibecoder V1.0.1</b>
            <span>Developed by <a href="https://rinoaprisedo.com" target="_blank" rel="noreferrer">rinoaprisedo.com</a></span>
          </footer>
        </div>
      </div>
    </div>
  );
}
