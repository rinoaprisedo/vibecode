import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { level, resetsIn, type Usage, type Win } from "./UsageBar";

export type Account = { id: string; name: string; loggedIn: boolean; method: string; email?: string; color?: string };

export const ACCOUNT_COLORS = ["#d97757", "#5b9bf5", "#7ec699", "#c586c0", "#e8b86b", "#4ec9c0", "#f06c8c", "#9aa0a6"];
// The colour chosen for an account, or a stable default by position so accounts differ out of the box.
export const accountColor = (accounts: Account[], id: string) => {
  const i = accounts.findIndex((a) => a.id === id);
  return accounts[i]?.color ?? ACCOUNT_COLORS[Math.max(i, 0) % ACCOUNT_COLORS.length];
};

function Meter({ label, w }: { label: string; w: Win }) {
  if (!w || w.utilization == null) return null;
  const pct = Math.min(100, Math.max(0, Math.round(w.utilization)));
  const lv = level(pct);
  return (
    <div className="am-meter">
      <div className="am-top">
        <span className="am-name">{label}</span>
        <span className={"am-pct u-pct" + lv}>{pct}%</span>
        <span className="am-reset">{w.resets_at ? resetsIn(w.resets_at) : "no usage yet"}</span>
      </div>
      <div className="u-track"><div className={"u-fill" + lv} style={{ width: pct + "%" }} /></div>
    </div>
  );
}

const readAutoSwitch = () => { try { return localStorage.getItem("vibecode.autoSwitch") !== "off"; } catch { return true; } };

// Which Claude account this session runs with. Other sessions can use a different one.
export function AccountMenu({ accounts, value, onChange, onManage }: {
  accounts: Account[]; value: string; onChange: (id: string) => void; onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [autoSwitch, setAutoSwitch] = useState(readAutoSwitch);
  const toggleAutoSwitch = () => {
    const next = !autoSwitch;
    try { localStorage.setItem("vibecode.autoSwitch", next ? "on" : "off"); } catch {}
    setAutoSwitch(next);
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setAutoSwitch(readAutoSwitch()); // Settings has the same switch: pick up changes made there
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Usage of every signed-in account, loaded when the menu opens so the limits are visible while choosing.
  const [usage, setUsage] = useState<Record<string, Usage | null>>({});
  useEffect(() => {
    if (!open) return;
    let alive = true;
    for (const a of accounts) {
      if (!a.loggedIn) continue;
      api<Usage>(`/api/usage?account=${a.id}`).then((u) => alive && setUsage((m) => ({ ...m, [a.id]: u })))
        .catch(() => alive && setUsage((m) => ({ ...m, [a.id]: null })));
    }
    return () => { alive = false; };
  }, [open, accounts]);

  const cur = accounts.find((a) => a.id === value);
  return (
    <div className="modemenu" ref={ref}>
      {open && (
        <div className="menu">
          <div className="menu-head"><span>Claude account</span></div>
          {accounts.map((a) => (
            <div key={a.id} className={"acc-card" + (a.id === value ? " on" : "")} onClick={() => { onChange(a.id); setOpen(false); }}>
              <div className="acc-head">
                <span className="ico" style={{ color: accountColor(accounts, a.id) }}><Icon name="user" size={18} /></span>
                <span className="txt"><b>{a.name}</b><small>{a.loggedIn ? a.email ?? a.method : "Not signed in"}</small></span>
                {a.id === value && <Icon name="check" size={16} className="check" />}
              </div>
              {a.loggedIn && (() => {
                const u = usage[a.id];
                if (u === undefined) return <div className="am-wait">Loading usage…</div>;
                if (!u?.available) return null;
                return <div className="am-usage"><Meter label="5h" w={u.five_hour} /><Meter label="7d" w={u.seven_day} /></div>;
              })()}
            </div>
          ))}
          <div className="menu-sep" />
          <div className="mode" onClick={toggleAutoSwitch} role="switch" aria-checked={autoSwitch}>
            <span className="ico"><Icon name="rotate" size={18} /></span>
            <span className="txt"><b>Auto-switch when limit hit</b><small>Move to another account that still has room and keep going.</small></span>
            <span className={"switch" + (autoSwitch ? " on" : "")} style={{ alignSelf: "center", flex: "none" }}><i /></span>
          </div>
          <div className="mode" onClick={() => { setOpen(false); onManage(); }}>
            <span className="ico"><Icon name="settings" size={18} /></span>
            <span className="txt"><b>Manage accounts…</b></span>
          </div>
        </div>
      )}
      <button className="modebtn iconbtn" onClick={() => setOpen(!open)} title={`Account: ${cur?.name ?? "none"}${cur && !cur.loggedIn ? " (not signed in)" : ""}`}>
        <span className="acc-badge" style={{ color: accountColor(accounts, value) }}><Icon name="user" size={16} /><span className="lbl">{cur?.name}</span></span>
        {cur && !cur.loggedIn && <span className="acc-warn" />}
      </button>
    </div>
  );
}
