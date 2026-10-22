import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Win = { utilization: number | null; resets_at: string | null } | null | undefined;
type Usage = { available: boolean; five_hour?: Win; seven_day?: Win };

// "3 jam 20 mnt lagi" / "3 hari lagi": time left until the limit window resets.
const resetsIn = (iso: string | null) => {
  if (!iso) return "";
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (mins <= 0) return "sebentar lagi";
  if (mins < 60) return `${mins} mnt lagi`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam${mins % 60 ? ` ${mins % 60} mnt` : ""} lagi`;
  const days = Math.floor(hours / 24), rest = hours % 24;
  return `${days} hari${days < 2 && rest ? ` ${rest} jam` : ""} lagi`;
};

const level = (pct: number) => (pct > 80 ? " hot" : pct >= 60 ? " warm" : " ok"); // <60 green, 60-80 yellow, >80 red
const fmt = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export type Context = { used: number; max: number };

// Context window of the session on screen: how much of the model's token budget is filled.
function ContextItem({ c }: { c: Context }) {
  const pct = Math.min(100, Math.round((c.used / c.max) * 100));
  const lv = level(pct);
  return (
    <div className="u-item u-ctx" title={`Context window: ${c.used.toLocaleString()} of ${c.max.toLocaleString()} tokens`}>
      <div className="u-top">
        <span className="u-label">Ctx</span>
        <div className="u-track"><div className={"u-fill" + lv} style={{ width: pct + "%" }} /></div>
        <span className={"u-pct" + lv}>{pct}%</span>
      </div>
      <div className="u-sub">{fmt(c.used)} / {fmt(c.max)} token</div>
    </div>
  );
}

function Item({ label, w }: { label: string; w: Win }) {
  if (!w || w.utilization == null) return null;
  const pct = Math.min(100, Math.max(0, Math.round(w.utilization)));
  const lv = level(pct);
  return (
    <div className="u-item" title={`${label} · ${resetsIn(w.resets_at)}`}>
      <div className="u-top">
        <span className="u-label">{label}</span>
        <div className="u-track"><div className={"u-fill" + lv} style={{ width: pct + "%" }} /></div>
        <span className={"u-pct" + lv}>{pct}%</span>
      </div>
      <div className="u-sub">{resetsIn(w.resets_at) || "\u00a0"}</div>
    </div>
  );
}

// Plan usage (5-hour session and weekly), refreshed on a timer and whenever `refreshKey` changes.
export function UsageBar({ refreshKey, context, account }: { refreshKey: number; context?: Context; account: string }) {
  const [usage, setUsage] = useState<Usage | null>(null);

  const prevAccount = useRef(account);
  useEffect(() => {
    // only clear when switching accounts; a plain refresh keeps the old numbers so nothing flashes
    if (prevAccount.current !== account) { prevAccount.current = account; setUsage(null); }
    let alive = true;
    const load = () => api<Usage>(`/api/usage?account=${account}`).then((u) => alive && setUsage(u)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [refreshKey, account]);

  const plan = usage?.available;
  if (!plan && !context) return null;
  return (
    <div className="usage">
      {context && <ContextItem c={context} />}
      {plan && <>
      <Item label="5h" w={usage!.five_hour} />
      <Item label="7d" w={usage!.seven_day} />
      </>}
    </div>
  );
}
