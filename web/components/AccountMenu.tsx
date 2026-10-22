import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export type Account = { id: string; name: string; loggedIn: boolean; method: string; email?: string; color?: string };

export const ACCOUNT_COLORS = ["#d97757", "#5b9bf5", "#7ec699", "#c586c0", "#e8b86b", "#4ec9c0", "#f06c8c", "#9aa0a6"];
// The colour chosen for an account, or a stable default by position so accounts differ out of the box.
export const accountColor = (accounts: Account[], id: string) => {
  const i = accounts.findIndex((a) => a.id === id);
  return accounts[i]?.color ?? ACCOUNT_COLORS[Math.max(i, 0) % ACCOUNT_COLORS.length];
};

// Which Claude account this session runs with. Other sessions can use a different one.
export function AccountMenu({ accounts, value, onChange, onManage }: {
  accounts: Account[]; value: string; onChange: (id: string) => void; onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const cur = accounts.find((a) => a.id === value);
  return (
    <div className="modemenu" ref={ref}>
      {open && (
        <div className="menu">
          <div className="menu-head"><span>Claude account</span></div>
          {accounts.map((a) => (
            <div key={a.id} className={"mode" + (a.id === value ? " on" : "")} onClick={() => { onChange(a.id); setOpen(false); }}>
              <span className="ico" style={{ color: accountColor(accounts, a.id) }}><Icon name="user" size={18} /></span>
              <span className="txt"><b>{a.name}</b><small>{a.loggedIn ? a.email ?? a.method : "Not signed in"}</small></span>
              {a.id === value && <Icon name="check" size={16} className="check" />}
            </div>
          ))}
          <div className="menu-sep" />
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
