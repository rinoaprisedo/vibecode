import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

// Token usage across every project, drawn from the totals the server keeps (see server/tokens.ts).
// "Tokens" here = input + output + cache writes; cache reads are re-used context and are shown separately.
type DayStat = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number; models?: Record<string, { tokens: number; cost: number }> };
type Stat = DayStat & { since: number; days?: Record<string, DayStat> };
type Proj = { id: string; name: string };

const RANGES = [{ days: 7, label: "7 days" }, { days: 14, label: "14 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }, { days: 0, label: "All time" }];
const tk = (s: DayStat) => s.input + s.output + s.cacheWrite;
const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n >= 1e4 ? Math.round(n / 1e3) : (n / 1e3).toFixed(1)) + "K" : String(Math.round(n)));
const money = (x: number) => "$" + (x >= 100 ? Math.round(x).toLocaleString() : x.toFixed(2));
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const dayLabel = (k: string, long = false) => parse(k).toLocaleDateString(undefined, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sum = (list: DayStat[]): DayStat => list.reduce((a, s) => ({ input: a.input + s.input, output: a.output + s.output, cacheRead: a.cacheRead + s.cacheRead, cacheWrite: a.cacheWrite + s.cacheWrite, cost: a.cost + s.cost, turns: a.turns + s.turns }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 });
const niceMax = (v: number) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
const modelName = (m: string) => m.replace(/^claude-/, "").replace(/-\d{8}$/, "");

type Row = DayStat & { id: string; name: string; closed?: boolean };

function analyze(data: Record<string, Stat>, projects: Proj[], range: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const allDays = Object.values(data).flatMap((s) => Object.keys(s.days ?? {})).sort();
  const first = allDays[0] ? parse(allDays[0]) : today;
  const span = range || Math.min(90, Math.max(14, Math.round((+today - +first) / 864e5) + 1));
  const keys = Array.from({ length: span }, (_, i) => key(addDays(today, i - span + 1)));
  const inRange = new Set(keys);
  const names = new Map(projects.map((p) => [p.id, p.name]));

  // one stat per project for the chosen range (All time uses the lifetime totals, which also cover days before daily history existed)
  const per = Object.entries(data).map(([id, s]) => {
    const st = range ? sum(Object.entries(s.days ?? {}).filter(([k]) => inRange.has(k)).map(([, d]) => d)) : sum([s]);
    return { id, name: names.get(id) ?? "", ...st };
  });
  const open: Row[] = per.filter((r) => names.has(r.id)).map((r) => ({ ...r }));
  const closed = per.filter((r) => !names.has(r.id));
  const rows: Row[] = [...open];
  if (closed.some((c) => tk(c) > 0)) rows.push({ id: "_closed", name: "Closed folders", closed: true, ...sum(closed) });
  rows.sort((a, b) => tk(b) - tk(a));

  const daily = keys.map((k) => ({ k, ...sum(Object.values(data).map((s) => s.days?.[k]).filter(Boolean) as DayStat[]) }));
  const total = sum(rows);
  const prev = range ? sum(Object.values(data).flatMap((s) => Array.from({ length: span }, (_, i) => s.days?.[key(addDays(today, i - 2 * span + 1))]).filter(Boolean) as DayStat[])) : null;

  const models = new Map<string, { tokens: number; cost: number }>();
  for (const s of Object.values(data)) {
    const sources = range ? Object.entries(s.days ?? {}).filter(([k]) => inRange.has(k)).map(([, d]) => d.models) : [s.models];
    for (const m of sources) for (const [name, v] of Object.entries(m ?? {})) { const t = models.get(name) ?? { tokens: 0, cost: 0 }; t.tokens += v.tokens; t.cost += v.cost; models.set(name, t); }
  }
  const lifetime = sum(Object.values(data)), dayTotal = sum(Object.values(data).flatMap((s) => Object.values(s.days ?? {})));
  const partial = range !== 0 && tk(lifetime) > tk(dayTotal) + 1; // usage recorded before daily history started only shows under All time
  return { keys, daily, rows, total, prev, models: [...models].sort((a, b) => b[1].tokens - a[1].tokens), partial, span };
}

function insights(a: ReturnType<typeof analyze>, range: number): string[] {
  const out: string[] = [];
  const t = tk(a.total);
  if (!t) return out;
  const live = a.rows.filter((r) => tk(r) > 0);
  if (live.length > 1) out.push(`${live[0].name} is the heaviest project: ${Math.round((tk(live[0]) / t) * 100)}% of all tokens (${fmt(tk(live[0]))}).`);
  if (a.prev && tk(a.prev) > 0) {
    const d = Math.round(((t - tk(a.prev)) / tk(a.prev)) * 100);
    out.push(Math.abs(d) < 3 ? `Usage is steady compared with the previous ${a.span} days.` : `Usage is ${d > 0 ? "up" : "down"} ${Math.abs(d)}% compared with the previous ${a.span} days.`);
  }
  const active = a.daily.filter((d) => tk(d) > 0);
  if (active.length > 1) {
    const peak = active.reduce((m, d) => (tk(d) > tk(m) ? d : m));
    out.push(`Busiest day: ${dayLabel(peak.k, true)} with ${fmt(tk(peak))} tokens (a typical active day is ${fmt(t / active.length)}).`);
  }
  const ctx = a.total.cacheRead + a.total.input + a.total.cacheWrite;
  if (a.total.cacheRead > 0 && ctx > 0) {
    const eff = Math.round((a.total.cacheRead / ctx) * 100);
    out.push(eff >= 70 ? `${eff}% of the context was served from cache, which keeps long sessions cheaper and faster.` : `Only ${eff}% of the context came from cache: many short or one-off sessions re-read their context from scratch.`);
  }
  const avg = a.total.turns ? t / a.total.turns : 0;
  const heavy = live.filter((r) => r.turns >= 3).map((r) => ({ r, per: tk(r) / r.turns })).sort((x, y) => y.per - x.per)[0];
  if (heavy && avg && heavy.per >= avg * 1.5) out.push(`${heavy.r.name} averages ${fmt(heavy.per)} tokens per turn, ${(heavy.per / avg).toFixed(1)}× the overall average (${fmt(avg)}).`);
  if (a.models.length > 1) out.push(`${modelName(a.models[0][0])} handles ${Math.round((a.models[0][1].tokens / a.models.reduce((s, m) => s + m[1].tokens, 0)) * 100)}% of the tokens; the rest goes to ${a.models.slice(1).map((m) => modelName(m[0])).join(", ")}.`);
  return out.slice(0, 5);
}

function DailyChart({ a }: { a: ReturnType<typeof analyze> }) {
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null);
  const vals = a.daily.map(tk);
  const top = Math.max(...vals, 0), max = niceMax(top);
  const peak = top > 0 ? vals.indexOf(top) : -1;
  const step = a.daily.length <= 7 ? 1 : a.daily.length <= 14 ? 2 : a.daily.length <= 31 ? 5 : 15;
  const show = (e: React.SyntheticEvent<HTMLElement>, i: number) => { // anchored to the top of the bar itself (or the slot's floor for an empty day)
    const r = e.currentTarget.getBoundingClientRect(), bar = e.currentTarget.querySelector(".us-bar")?.getBoundingClientRect();
    setTip({ x: Math.max(100, Math.min(r.left + r.width / 2, window.innerWidth - 100)), y: bar ? bar.top : r.bottom - 4, i });
  };
  const d = tip ? a.daily[tip.i] : null;
  return (
    <div className="us-chart">
      <div className="us-y">{[max, max / 2, 0].map((v, i) => <span key={i} style={{ bottom: `${(v / max) * 100}%` }}>{fmt(v)}</span>)}</div>
      <div className="us-plot">
        {[0, 50, 100].map((p) => <i key={p} className="us-grid" style={{ bottom: `${p}%` }} />)}
        <div className="us-cols">
          {a.daily.map((day, i) => (
            <div key={day.k} className="us-slot" tabIndex={0} onPointerMove={(e) => show(e, i)} onPointerLeave={() => setTip(null)} onFocus={(e) => show(e, i)} onBlur={() => setTip(null)}
              aria-label={`${dayLabel(day.k, true)}: ${fmt(vals[i])} tokens`}>
              {vals[i] > 0 && <i className="us-bar" style={{ height: `${Math.max(1.5, (vals[i] / max) * 100)}%` }}>{i === peak && <b className="us-peak">{fmt(vals[i])}</b>}</i>}
            </div>
          ))}
        </div>
        <div className="us-x">{a.daily.map((day, i) => <span key={day.k}>{i % step === (a.daily.length - 1) % step ? dayLabel(day.k) : ""}</span>)}</div>
      </div>
      {tip && d && createPortal(
        <div className="us-tip" style={{ left: tip.x, top: tip.y - 8 }}>
          <div className="us-tip-v">{fmt(tk(d))}<small> tokens</small></div>
          <div className="us-tip-d">{dayLabel(d.k, true)}</div>
          <div className="us-tip-m">{d.turns} turn{d.turns === 1 ? "" : "s"} · {money(d.cost)}</div>
        </div>, document.body)}
    </div>
  );
}

export function UsagePanel({ projects, active }: { projects: Proj[]; active: boolean }) {
  const [data, setData] = useState<Record<string, Stat> | null>(null);
  const [range, setRange] = useState(30);
  const [view, setView] = useState<"chart" | "table">("chart");
  useEffect(() => {
    if (!active) return;
    const load = () => api<Record<string, Stat>>("/api/tokens").then(setData).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [active]);

  const a = useMemo(() => (data ? analyze(data, projects, range) : null), [data, projects, range]);
  const tips = useMemo(() => (a ? insights(a, range) : []), [a, range]);
  const total = a ? tk(a.total) : 0;
  const maxRow = a ? Math.max(1, ...a.rows.map(tk)) : 1;
  const modelTotal = a ? a.models.reduce((s, m) => s + m[1].tokens, 0) : 0;
  const delta = a?.prev && tk(a.prev) > 0 ? Math.round(((total - tk(a.prev)) / tk(a.prev)) * 100) : null;
  const rangeName = RANGES.find((r) => r.days === range)!.label.toLowerCase();

  return (
    <div className="us-root">
      <div className="us-scroll">
        <div className="us-head">
          <div><h2>Token usage</h2><p className="muted">All projects · tokens are input + output + cache writes; cache reads are shown apart</p></div>
          <div className="us-ranges" role="group" aria-label="Date range">
            {RANGES.map((r) => <button key={r.days} className={range === r.days ? "on" : ""} onClick={() => setRange(r.days)}>{r.label}</button>)}
          </div>
        </div>

        {!a ? <div className="pg-empty"><span className="spin" /></div> : !total && !a.rows.length ? (
          <div className="us-empty"><Icon name="chart" size={30} /><h4>No usage recorded yet</h4><p className="muted">Tokens are counted when a chat turn finishes, per project. Send a message and the numbers appear here.</p></div>
        ) : (
          <>
            <div className="us-kpis">
              <div className="us-kpi"><span>Total tokens</span><b>{fmt(total)}</b>{delta !== null && <em>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs previous period</em>}{delta === null && <em>{rangeName}</em>}</div>
              <div className="us-kpi"><span>Estimated cost</span><b>{money(a.total.cost)}</b><em>list-price estimate</em></div>
              <div className="us-kpi"><span>Turns</span><b>{a.total.turns.toLocaleString()}</b><em>{a.daily.filter((d) => d.turns > 0).length} active day{a.daily.filter((d) => d.turns > 0).length === 1 ? "" : "s"}</em></div>
              <div className="us-kpi"><span>Average per turn</span><b>{a.total.turns ? fmt(total / a.total.turns) : "–"}</b><em>{a.total.turns ? `${money(a.total.cost / a.total.turns)} per turn` : ""}</em></div>
            </div>

            {tips.length > 0 && (
              <section className="us-card">
                <h3>Insights</h3>
                <ul className="us-insights">{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </section>
            )}

            <section className="us-card">
              <div className="us-card-head">
                <h3>Tokens per day</h3>
                <div className="us-ranges small" role="group" aria-label="View">
                  <button className={view === "chart" ? "on" : ""} onClick={() => setView("chart")}>Chart</button>
                  <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table</button>
                </div>
              </div>
              {view === "chart" ? <DailyChart a={a} /> : (
                <table className="dk-table us-table">
                  <thead><tr><th>Date</th><th className="r">Tokens</th><th className="r">Turns</th><th className="r">Cost</th></tr></thead>
                  <tbody>{[...a.daily].reverse().filter((d) => d.turns > 0).map((d) => <tr key={d.k}><td>{dayLabel(d.k, true)}</td><td className="r mono">{tk(d).toLocaleString()}</td><td className="r">{d.turns}</td><td className="r">{money(d.cost)}</td></tr>)}
                    {!a.daily.some((d) => d.turns > 0) && <tr><td colSpan={4} className="faint">No days with usage in this range.</td></tr>}</tbody>
                </table>
              )}
            </section>

            <section className="us-card">
              <h3>By project</h3>
              <div className="us-prow us-phead"><span>Project</span><span /><span className="r">Tokens</span><span className="r">Share</span><span className="r">Cost</span><span className="r">Turns</span><span className="r">Avg / turn</span></div>
              {a.rows.map((r) => (
                <div key={r.id} className={"us-prow" + (r.closed ? " closed" : "")}
                  title={`Input ${r.input.toLocaleString()} · Output ${r.output.toLocaleString()} · Cache write ${r.cacheWrite.toLocaleString()} · Cache read ${r.cacheRead.toLocaleString()} (not counted)`}>
                  <span className="us-pname">{r.name}</span>
                  <span className="us-track"><i style={{ width: `${(tk(r) / maxRow) * 100}%` }} /></span>
                  <span className="r mono">{fmt(tk(r))}</span>
                  <span className="r faint">{total ? Math.round((tk(r) / total) * 100) : 0}%</span>
                  <span className="r">{money(r.cost)}</span>
                  <span className="r">{r.turns}</span>
                  <span className="r">{r.turns ? fmt(tk(r) / r.turns) : "–"}</span>
                </div>
              ))}
            </section>

            {a.models.length > 0 && (
              <section className="us-card">
                <h3>By model</h3>
                {a.models.map(([name, m]) => (
                  <div key={name} className="us-mrow">
                    <span className="us-pname" title={name}>{modelName(name)}</span>
                    <span className="us-track"><i style={{ width: `${modelTotal ? (m.tokens / modelTotal) * 100 : 0}%` }} /></span>
                    <span className="r mono">{fmt(m.tokens)}</span>
                    <span className="r faint">{modelTotal ? Math.round((m.tokens / modelTotal) * 100) : 0}%</span>
                    <span className="r">{money(m.cost)}</span>
                  </div>
                ))}
              </section>
            )}

            <p className="us-foot faint">
              Cache reads in this range: {fmt(a.total.cacheRead)} (not counted above).
              {a.partial && " Usage recorded before daily history began only appears under All time."}
              {" "}Costs are estimates from list prices and may differ from your plan. Right-click a folder in the explorer to reset its counter.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
