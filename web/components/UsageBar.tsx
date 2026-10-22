import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Win = { utilization: number | null; resets_at: string | null } | null | undefined;
type Usage = { available: boolean; five_hour?: Win; seven_day?: Win };

const resetsIn = (iso: string | null) => {
  if (!iso) return "";
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (s <= 0) return "Resets now";
  if (s < 3600) return `Resets in ${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `Resets in ${Math.round(s / 3600)}h`;
  return `Resets in ${Math.round(s / 86400)}d`;
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
      <span className="u-label">Ctx</span>
      <div className="u-track"><div className={"u-fill" + lv} style={{ width: pct + "%" }} /></div>
      <span className="u-tok">{fmt(c.used)}/{fmt(c.max)}</span>
      <span className={"u-pct" + lv}>{pct}%</span>
    </div>
  );
}

function Item({ label, w }: { label: string; w: Win }) {
  if (!w || w.utilization == null) return null;
  const pct = Math.min(100, Math.max(0, Math.round(w.utilization)));
  const lv = level(pct);
  return (
    <div className="u-item" title={`${label} · ${resetsIn(w.resets_at)}`}>
      <span className="u-label">{label}</span>
      <div className="u-track"><div className={"u-fill" + lv} style={{ width: pct + "%" }} /></div>
      <span className={"u-pct" + lv}>{pct}%</span>
    </div>
  );
}

// Plan usage (5-hour session and weekly), refreshed on a timer and whenever `refreshKey` changes.
export function UsageBar({ refreshKey, context, account }: { refreshKey: number; context?: Context; account: string }) {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    setUsage(null);
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
