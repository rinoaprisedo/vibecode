import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

type Kind = "postgres" | "mysql" | "redis";
type Conn = { id: string; project: string; kind: Kind; name: string; host: string; port: number; database: string; user: string; ssl: boolean; readOnly: boolean; hasPassword: boolean };
type Form = Omit<Conn, "id" | "hasPassword" | "project"> & { id?: string; password: string; url: string };
type TableRef = { schema: string; name: string; kind: string; rows: number };
type Result = { columns: string[]; rows: Record<string, any>[]; truncated: boolean; ms: number; count: number; command: string };
type Describe = {
  columns: { name: string; type: string; nullable: boolean; default: string | null; pk: boolean; comment: string | null }[];
  indexes: { name: string; def: string }[]; constraints: { name: string; type: string; def: string }[];
  size: string; rows: number; comment: string | null;
};

const call = <T = any,>(act: string, body: unknown = {}) => api<T>(`/api/db/${act}`, { body });
const KIND_LABEL: Record<Kind, string> = { postgres: "PostgreSQL", mysql: "MySQL", redis: "Redis" };
const DEFAULTS: Record<Kind, { port: number; database: string; user: string }> = {
  postgres: { port: 5432, database: "postgres", user: "postgres" },
  mysql: { port: 3306, database: "", user: "root" },
  redis: { port: 6379, database: "0", user: "" },
};
const URL_HINT: Record<Kind, string> = { postgres: "postgres://user:password@host:5432/database", mysql: "mysql://user:password@host:3306/database", redis: "redis://:password@host:6379/0" };
const blank = (kind: Kind = "postgres"): Form => ({ name: "", kind, host: "localhost", ...DEFAULTS[kind], password: "", ssl: false, readOnly: false, url: "" });
const fmtN = (n: number) => n.toLocaleString("en-US");
const show = (v: any) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// postgres://, mysql://, redis:// connection strings → form fields
const KIND_OF_SCHEME: Record<string, Kind> = { "postgres:": "postgres", "postgresql:": "postgres", "mysql:": "mysql", "mariadb:": "mysql", "redis:": "redis", "rediss:": "redis" };
function fromUrl(text: string, f: Form): Form {
  try {
    const u = new URL(text.trim());
    const kind = KIND_OF_SCHEME[u.protocol];
    if (!kind) return f;
    const db = decodeURIComponent(u.pathname.slice(1));
    return {
      ...f, kind, host: u.hostname || f.host, port: Number(u.port) || DEFAULTS[kind].port,
      database: kind === "redis" ? (/^\d+$/.test(db) ? db : "0") : db || (kind === "mysql" ? "" : f.database),
      user: decodeURIComponent(u.username) || (kind === "redis" ? "" : DEFAULTS[kind].user), password: decodeURIComponent(u.password) || f.password,
      ssl: u.protocol === "rediss:" || /ssl(mode)?=(require|verify|true)/.test(u.search) || f.ssl, name: f.name || u.hostname,
    };
  } catch { return f; }
}

function Grid({ res, sort, onSort }: { res: Result; sort?: { col: string; dir: "asc" | "desc" } | null; onSort?: (c: string) => void }) {
  if (!res.columns.length) return <div className="pg-empty">{res.command ? `${res.command} · ${fmtN(res.count)} row(s) affected` : "No rows."}</div>;
  return (
    <div className="pg-grid">
      <table>
        <thead>
          <tr>
            <th className="pg-n">#</th>
            {res.columns.map((c) => (
              <th key={c} className={onSort ? "sortable" : ""} onClick={() => onSort?.(c)}>
                {c}{sort?.col === c && <span className="pg-arrow">{sort.dir === "asc" ? " ↑" : " ↓"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {res.rows.map((r, i) => (
            <tr key={i}>
              <td className="pg-n">{i + 1}</td>
              {res.columns.map((c) => {
                const v = r[c];
                return <td key={c} className={v === null ? "null" : typeof v === "number" ? "num" : ""} title={show(v)}
                  onDoubleClick={() => navigator.clipboard?.writeText(show(v)).catch(() => {})}>{v === null ? "NULL" : show(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataView({ id, t }: { id: string; t: TableRef }) {
  const SIZE = 100;
  const [res, setRes] = useState<Result | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [where, setWhere] = useState("");
  const [applied, setApplied] = useState("");
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true); setErr("");
    call<Result>("rows", { id, schema: t.schema, table: t.name, limit: SIZE, offset: page * SIZE, order: sort?.col, dir: sort?.dir, where: applied })
      .then(setRes).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, [id, t.schema, t.name, page, sort, applied]);
  useEffect(load, [load]);
  useEffect(() => {
    setTotal(null);
    call<{ count: number }>("count", { id, schema: t.schema, table: t.name, where: applied }).then((r) => setTotal(r.count)).catch(() => {});
  }, [id, t.schema, t.name, applied]);

  const pages = total === null ? null : Math.max(1, Math.ceil(total / SIZE));
  const onSort = (c: string) => { setPage(0); setSort((s) => (s?.col !== c ? { col: c, dir: "asc" } : s.dir === "asc" ? { col: c, dir: "desc" } : null)); };

  return (
    <div className="pg-data">
      <div className="pg-bar">
        <div className="dk-search pg-where">
          <span className="faint">WHERE</span>
          <input value={where} placeholder="id > 10 and status = 'active'" spellCheck={false}
            onChange={(e) => setWhere(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); setApplied(where); } }} />
        </div>
        <button onClick={() => { setPage(0); setApplied(where); }} disabled={busy}>Apply</button>
        <button onClick={load} disabled={busy} title="Reload"><Icon name="rotate" size={13} /></button>
        <span style={{ flex: 1 }} />
        <span className="muted pg-meta">{total === null ? "…" : `${fmtN(total)} rows`}{res && ` · ${res.ms} ms`}</span>
        <button disabled={page === 0 || busy} onClick={() => setPage((p) => p - 1)}><Icon name="chevronRight" size={13} className="pg-flip" /></button>
        <span className="pg-meta">{page + 1}{pages ? ` / ${pages}` : ""}</span>
        <button disabled={busy || !res || res.rows.length < SIZE || (pages !== null && page + 1 >= pages)} onClick={() => setPage((p) => p + 1)}><Icon name="chevronRight" size={13} /></button>
      </div>
      {err ? <div className="pg-error">{err}</div> : res ? <Grid res={res} sort={sort} onSort={onSort} /> : <div className="pg-empty"><span className="spin" /></div>}
    </div>
  );
}

function StructureView({ id, t }: { id: string; t: TableRef }) {
  const [d, setD] = useState<Describe | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setD(null); setErr("");
    call<Describe>("describe", { id, schema: t.schema, table: t.name }).then(setD).catch((e) => setErr(e.message));
  }, [id, t.schema, t.name]);
  if (err) return <div className="pg-error">{err}</div>;
  if (!d) return <div className="pg-empty"><span className="spin" /></div>;
  return (
    <div className="pg-struct">
      <div className="pg-facts">
        <span><b>{fmtN(d.rows)}</b> rows (estimate)</span><span><b>{d.size}</b> on disk</span><span><b>{d.columns.length}</b> columns</span>
        {d.comment && <span className="muted">{d.comment}</span>}
      </div>
      <h4>Columns</h4>
      <table className="dk-table">
        <thead><tr><th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>Comment</th></tr></thead>
        <tbody>
          {d.columns.map((c) => (
            <tr key={c.name}>
              <td><b>{c.name}</b> {c.pk && <span className="dk-pill ok">PK</span>}</td>
              <td className="mono">{c.type}</td>
              <td className="faint">{c.nullable ? "yes" : "no"}</td>
              <td className="mono faint">{c.default ?? ""}</td>
              <td className="faint">{c.comment ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.constraints.length > 0 && <>
        <h4>Constraints</h4>
        <table className="dk-table"><tbody>
          {d.constraints.map((c) => <tr key={c.name}><td><b>{c.name}</b></td><td><span className="dk-pill">{c.type}</span></td><td className="mono faint">{c.def}</td></tr>)}
        </tbody></table>
      </>}
      {d.indexes.length > 0 && <>
        <h4>Indexes</h4>
        <table className="dk-table"><tbody>
          {d.indexes.map((c) => <tr key={c.name}><td><b>{c.name}</b></td><td className="mono faint">{c.def}</td></tr>)}
        </tbody></table>
      </>}
    </div>
  );
}

function QueryView({ id, tables }: { id: string; tables: TableRef[] }) {
  const [sql, setSql] = useState("select now();");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [history, setHistory] = useState<string[]>([]);

  const run = async () => {
    const el = ta.current;
    // a selection runs on its own, otherwise the whole editor
    const text = el && el.selectionStart !== el.selectionEnd ? sql.slice(el.selectionStart, el.selectionEnd) : sql;
    if (!text.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      setRes(await call<Result>("query", { id, sql: text }));
      setHistory((h) => [text.trim(), ...h.filter((x) => x !== text.trim())].slice(0, 30));
    } catch (e: any) { setErr(e.message); setRes(null); }
    finally { setBusy(false); }
  };

  return (
    <div className="pg-query">
      <div className="pg-editor">
        <textarea ref={ta} value={sql} spellCheck={false} placeholder="select * from users limit 10;"
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); }
            if (e.key === "Tab") { e.preventDefault(); const s = e.currentTarget.selectionStart; setSql(sql.slice(0, s) + "  " + sql.slice(e.currentTarget.selectionEnd)); requestAnimationFrame(() => ta.current?.setSelectionRange(s + 2, s + 2)); }
          }} />
        <div className="pg-bar">
          <button className="primary" onClick={run} disabled={busy}>{busy ? <span className="spin" /> : <Icon name="play" size={12} />} Run</button>
          <span className="faint pg-meta"><kbd>⌘</kbd> <kbd>Enter</kbd> runs · select text to run only that</span>
          <span style={{ flex: 1 }} />
          {history.length > 0 && (
            <select value="" onChange={(e) => e.target.value && setSql(e.target.value)} title="Recent queries">
              <option value="">Recent…</option>
              {history.map((h, i) => <option key={i} value={h}>{h.replace(/\s+/g, " ").slice(0, 80)}</option>)}
            </select>
          )}
          {res && <span className="muted pg-meta">{res.columns.length ? `${fmtN(res.rows.length)} row(s)${res.truncated ? " (first 1000)" : ""}` : res.command} · {res.ms} ms</span>}
        </div>
      </div>
      {err ? <div className="pg-error">{err}</div> : res ? <Grid res={res} /> : <div className="pg-empty muted">{tables.length} tables available · results show here</div>}
    </div>
  );
}

function Session({ conn, onEdit }: { conn: Conn; onEdit: () => void }) {
  const [tables, setTables] = useState<TableRef[] | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<TableRef | null>(null);
  const [mode, setMode] = useState<"data" | "structure" | "query">("query");

  const load = useCallback(() => {
    setErr("");
    call<TableRef[]>("tables", { id: conn.id }).then(setTables).catch((e) => { setErr(e.message); setTables([]); });
  }, [conn.id]);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const m = new Map<string, TableRef[]>();
    for (const t of tables ?? []) if (!needle || t.name.toLowerCase().includes(needle)) m.set(t.schema, [...(m.get(t.schema) ?? []), t]);
    return [...m];
  }, [tables, filter]);

  const pick = (t: TableRef) => { setSel(t); setMode((m) => (m === "query" ? "data" : m)); };

  return (
    <div className="pg-session">
      <aside className="pg-side">
        <div className="pg-sidehead">
          <div className="dk-search"><Icon name="search" size={13} /><input value={filter} placeholder="Filter tables" onChange={(e) => setFilter(e.target.value)} /></div>
          <button onClick={load} title="Refresh"><Icon name="rotate" size={13} /></button>
        </div>
        <div className="pg-tables">
          {tables === null && <div className="pg-empty"><span className="spin" /></div>}
          {groups.map(([schema, list]) => (
            <div key={schema}>
              <div className="pg-schema" onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(schema) ? n.delete(schema) : n.add(schema); return n; })}>
                <Icon name={collapsed.has(schema) ? "chevronRight" : "chevronDown"} size={12} /> <b>{schema}</b> <span className="faint">{list.length}</span>
              </div>
              {!collapsed.has(schema) && list.map((t) => (
                <div key={t.name} className={"pg-table" + (sel?.schema === t.schema && sel.name === t.name && mode !== "query" ? " sel" : "")} onClick={() => pick(t)} title={`${t.kind} · ~${fmtN(t.rows)} rows`}>
                  <Icon name={t.kind === "table" ? "database" : "layers"} size={12} /> <span>{t.name}</span>
                  <small className="faint">{t.rows > 0 ? fmtN(t.rows) : ""}</small>
                </div>
              ))}
            </div>
          ))}
          {tables && !groups.length && !err && <div className="pg-empty muted">No tables.</div>}
        </div>
      </aside>
      <section className="pg-main">
        {err ? (
          <div className="pg-error">{err}<div><button onClick={onEdit}>Edit connection</button> <button onClick={load}>Retry</button></div></div>
        ) : (
          <>
            <div className="dk-tabs">
              <button className={mode === "query" ? "on" : ""} onClick={() => setMode("query")}><Icon name="terminal" size={13} /> Query</button>
              {sel && <>
                <button className={mode === "data" ? "on" : ""} onClick={() => setMode("data")}>Data</button>
                <button className={mode === "structure" ? "on" : ""} onClick={() => setMode("structure")}>Structure</button>
                <span className="pg-crumb"><b>{sel.schema}.{sel.name}</b></span>
              </>}
            </div>
            <div className="pg-body">
              {/* the query view stays mounted so the text and the result survive a look at a table */}
              <div className="pg-pane" hidden={mode !== "query"}><QueryView id={conn.id} tables={tables ?? []} /></div>
              {sel && mode === "data" && <DataView key={sel.schema + "." + sel.name} id={conn.id} t={sel} />}
              {sel && mode === "structure" && <StructureView id={conn.id} t={sel} />}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---- Redis ---------------------------------------------------------------------------------------------------------------------------

type RKey = { key: string; type: string; ttl: number };
type RValue = { type: string; ttl: number; size: number; value: any; truncated: boolean };
type RInfo = { version: string; mode: string; memory: string; clients: string; uptimeDays: string; keys: number };

const ttlText = (ms: number) => ms === -1 ? "no expiry" : ms < 0 ? "gone" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : ms < 86_400_000 ? `${(ms / 3_600_000).toFixed(1)} h` : `${(ms / 86_400_000).toFixed(1)} d`;
// redis-cli style rendering of a reply
function fmtReply(v: any, indent = ""): string {
  if (v === null || v === undefined) return "(nil)";
  if (typeof v === "number") return `(integer) ${v}`;
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return v.length ? v.map((x, i) => `${indent}${i + 1}) ${fmtReply(x, indent + "   ").trimStart()}`).join("\n") : "(empty array)";
  return JSON.stringify(v, null, 2);
}

function RedisValueView({ id, k, readOnly, onDeleted }: { id: string; k: RKey; readOnly: boolean; onDeleted: () => void }) {
  const [d, setD] = useState<RValue | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => { setErr(""); call<RValue>("rget", { id, key: k.key }).then(setD).catch((e) => { setD(null); setErr(e.message); }); }, [id, k.key]);
  useEffect(() => { setD(null); load(); }, [load]);
  const del = async () => { if (!confirm(`Delete key "${k.key}"?`)) return; try { await call("rdel", { id, key: k.key }); onDeleted(); } catch (e: any) { setErr(e.message); } };

  if (err) return <div className="pg-error">{err}<div><button onClick={load}>Retry</button> <button onClick={onDeleted}>Close</button></div></div>;
  if (!d) return <div className="pg-empty"><span className="spin" /></div>;
  let body: React.ReactNode;
  if (d.type === "string") {
    let text = String(d.value ?? "");
    try { const j = JSON.parse(text); if (j && typeof j === "object") text = JSON.stringify(j, null, 2); } catch {}
    body = <pre className="rd-val">{text}</pre>;
  } else if (d.type === "hash" || d.type === "zset") {
    body = <table className="dk-table"><thead><tr><th>{d.type === "hash" ? "Field" : "Member"}</th><th>{d.type === "hash" ? "Value" : "Score"}</th></tr></thead>
      <tbody>{(d.value as [string, any][]).map(([a, b], i) => <tr key={i}><td className="mono">{a}</td><td className="mono">{show(b)}</td></tr>)}</tbody></table>;
  } else if (d.type === "stream") {
    body = <table className="dk-table"><thead><tr><th>ID</th><th>Fields</th></tr></thead>
      <tbody>{(d.value as [string, string[]][]).map(([sid, f], i) => <tr key={i}><td className="mono">{sid}</td><td className="mono">{Array.isArray(f) ? f.reduce<string[]>((o, x, j) => (j % 2 ? ((o[o.length - 1] += "=" + x), o) : [...o, x]), []).join("  ") : show(f)}</td></tr>)}</tbody></table>;
  } else {
    body = <table className="dk-table"><thead><tr><th>#</th><th>{d.type === "list" ? "Value" : "Member"}</th></tr></thead>
      <tbody>{(d.value as any[]).map((v, i) => <tr key={i}><td className="faint">{i}</td><td className="mono">{show(v)}</td></tr>)}</tbody></table>;
  }
  return (
    <div className="pg-struct">
      <div className="pg-facts">
        <span className="dk-pill acc">{d.type}</span>
        <span><b>{fmtN(d.size)}</b> {d.type === "string" ? "bytes" : d.type === "stream" ? "entries" : "items"}</span>
        <span>TTL <b>{ttlText(d.ttl)}</b></span>
        <span style={{ flex: 1 }} />
        <button onClick={load} title="Reload"><Icon name="rotate" size={13} /></button>
        <button className="danger" disabled={readOnly} title={readOnly ? "Read-only connection" : "Delete this key"} onClick={del}><Icon name="trash" size={13} /> Delete</button>
      </div>
      <h4 className="mono">{k.key}</h4>
      {body}
      {d.truncated && <p className="faint pg-note">Showing the first {Array.isArray(d.value) ? d.value.length : 500} of {fmtN(d.size)} items.</p>}
    </div>
  );
}

function RedisConsole({ id }: { id: string }) {
  const [line, setLine] = useState("");
  const [log, setLog] = useState<{ cmd: string; out: string; bad?: boolean; ms?: number }[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [pos, setPos] = useState(-1);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [log]);
  const run = async () => {
    const cmd = line.trim();
    if (!cmd || busy) return;
    setBusy(true); setLine(""); setPos(-1);
    setHist((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50));
    try { const r = await call<{ reply: any; ms: number }>("rexec", { id, command: cmd }); setLog((l) => [...l, { cmd, out: fmtReply(r.reply), ms: r.ms }]); }
    catch (e: any) { setLog((l) => [...l, { cmd, out: e.message, bad: true }]); }
    finally { setBusy(false); }
  };
  return (
    <div className="pg-query">
      <div className="rd-log">
        {!log.length && <div className="pg-empty muted">Type a Redis command, e.g. <code>KEYS user:*</code> or <code>HGETALL user:1</code>. ↑ / ↓ recall earlier commands.</div>}
        {log.map((l, i) => (
          <div key={i} className="rd-entry">
            <div className="rd-cmd"><span className="faint">&gt;</span> {l.cmd}{l.ms !== undefined && <small className="faint"> · {l.ms} ms</small>}</div>
            <pre className={l.bad ? "rd-out bad" : "rd-out"}>{l.out}</pre>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="rd-input">
        <span className="faint">&gt;</span>
        <input value={line} spellCheck={false} autoFocus placeholder="SET key value" disabled={busy} onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
            else if (e.key === "ArrowUp" && hist.length) { e.preventDefault(); const n = Math.min(pos + 1, hist.length - 1); setPos(n); setLine(hist[n]); }
            else if (e.key === "ArrowDown") { e.preventDefault(); const n = pos - 1; setPos(n); setLine(n >= 0 ? hist[n] : ""); }
          }} />
        <button onClick={() => setLog([])} disabled={!log.length} title="Clear output"><Icon name="trash" size={13} /></button>
        <button className="primary" onClick={run} disabled={busy || !line.trim()}><Icon name="play" size={12} /> Run</button>
      </div>
    </div>
  );
}

function RedisSession({ conn, onEdit }: { conn: Conn; onEdit: () => void }) {
  const [filter, setFilter] = useState("");
  const [applied, setApplied] = useState("*");
  const [keys, setKeys] = useState<RKey[] | null>(null);
  const [cursor, setCursor] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<RKey | null>(null);
  const [mode, setMode] = useState<"console" | "key">("console");
  const [info, setInfo] = useState<RInfo | null>(null);

  // SCAN pages can come back empty for a rare pattern, so keep going (a bounded number of rounds) until something turns up.
  const fetchKeys = useCallback(async (reset: boolean, from: string) => {
    setBusy(true); setErr("");
    try {
      let cur = reset ? "0" : from, got: RKey[] = [];
      for (let i = 0; i < 30; i++) {
        const r = await call<{ cursor: string; keys: RKey[] }>("rkeys", { id: conn.id, pattern: applied, cursor: cur });
        cur = r.cursor; got = got.concat(r.keys);
        if (cur === "0" || got.length >= 50) break;
      }
      setKeys((k) => (reset ? got : [...(k ?? []), ...got])); setCursor(cur);
    } catch (e: any) { setErr(e.message); setKeys((k) => k ?? []); }
    finally { setBusy(false); }
  }, [conn.id, applied]);
  const reload = useCallback(() => { fetchKeys(true, "0"); call<RInfo>("rinfo", { id: conn.id }).then(setInfo).catch(() => {}); }, [fetchKeys, conn.id]);
  useEffect(reload, [reload]);
  const apply = () => { const t = filter.trim(); setApplied(!t ? "*" : /[*?\[]/.test(t) ? t : `*${t}*`); };
  const pick = (k: RKey) => { setSel(k); setMode("key"); };

  return (
    <div className="pg-session">
      <aside className="pg-side">
        <div className="pg-sidehead">
          <div className="dk-search"><Icon name="search" size={13} /><input value={filter} placeholder="Search keys (user:*)" spellCheck={false}
            onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} /></div>
          <button onClick={reload} title="Refresh"><Icon name="rotate" size={13} /></button>
        </div>
        <div className="pg-tables">
          {keys === null && <div className="pg-empty"><span className="spin" /></div>}
          {(keys ?? []).map((k) => (
            <div key={k.key} className={"pg-table rd-key" + (sel?.key === k.key && mode === "key" ? " sel" : "")} onClick={() => pick(k)} title={`${k.key} · ${k.type} · ${ttlText(k.ttl)}`}>
              <span className={"rd-type t-" + k.type}>{k.type.slice(0, 4)}</span> <span>{k.key}</span>
              <small className="faint">{k.ttl >= 0 ? ttlText(k.ttl) : ""}</small>
            </div>
          ))}
          {keys && !keys.length && !err && !busy && <div className="pg-empty muted">No keys.</div>}
          {busy && keys !== null && <div className="pg-empty"><span className="spin" /></div>}
          {cursor !== "0" && !busy && <button className="rd-more" onClick={() => fetchKeys(false, cursor)}>Load more</button>}
        </div>
      </aside>
      <section className="pg-main">
        <div className="dk-tabs">
          <button className={mode === "console" ? "on" : ""} onClick={() => setMode("console")}><Icon name="terminal" size={13} /> Console</button>
          {sel && <button className={mode === "key" ? "on" : ""} onClick={() => setMode("key")}>Key</button>}
          <span className="pg-crumb">{info ? <>Redis <b>{info.version}</b> · db{conn.database} · <b>{fmtN(info.keys)}</b> keys · {info.memory}</> : ""}</span>
        </div>
        {err && <div className="pg-error">{err}<div><button onClick={onEdit}>Edit connection</button> <button onClick={reload}>Retry</button></div></div>}
        <div className="pg-body">
          <div className="pg-pane" hidden={mode !== "console"}><RedisConsole id={conn.id} /></div>
          {sel && mode === "key" && <RedisValueView key={sel.key} id={conn.id} k={sel} readOnly={conn.readOnly}
            onDeleted={() => { setKeys((k) => (k ?? []).filter((x) => x.key !== sel.key)); setSel(null); setMode("console"); }} />}
        </div>
      </section>
    </div>
  );
}

function ConnForm({ project, initial, want, onSaved, onCancel }: { project: string; initial: Form; want?: string; onSaved: (c: Conn) => void; onCancel: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const body = () => { const { url, ...rest } = f; return { ...rest, project }; };

  // A new connection starts filled from the project's running database container (the first match), with the others offered as chips.
  type Guess = { kind: Kind; container: string; image: string; host: string; port: number; database: string; user: string; password: string; inProject: boolean };
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [picked, setPicked] = useState("");
  const apply = (g: Guess) => { setPicked(g.container); setF((x) => ({ ...x, kind: g.kind, name: g.container, host: g.host, port: g.port, database: g.database, user: g.user, password: g.password })); };
  useEffect(() => {
    if (initial.id) return;
    let live = true;
    api<Guess[]>("/api/db/detect", { project }).then((list) => { if (live && list.length) { setGuesses(list); apply(list.find((g) => g.container === want) ?? list[0]); } }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Switching type moves port / user / database to that type's defaults, unless they were changed by hand.
  const setKind = (k: Kind) => setF((x) => { const o = DEFAULTS[x.kind], d = DEFAULTS[k]; return { ...x, kind: k, port: x.port === o.port ? d.port : x.port, user: x.user === o.user ? d.user : x.user, database: x.database === o.database ? d.database : x.database }; });
  const redisKind = f.kind === "redis";

  const test = async () => {
    setBusy(true); setMsg(null);
    try { const r = await call<{ version: string; database: string }>("test", body()); setMsg({ text: `Connected to ${r.database} · ${r.version}` }); }
    catch (e: any) { setMsg({ text: e.message, bad: true }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { onSaved(await call<Conn>("save", body())); }
    catch (e: any) { setMsg({ text: e.message, bad: true }); setBusy(false); }
  };

  return (
    <div className="pg-form">
      <h3>{f.id ? "Edit connection" : "New connection"}</h3>
      {!f.id && (
        <div className="dk-tabs pg-kinds">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <button key={k} type="button" className={f.kind === k ? "on" : ""} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
        </div>
      )}
      {guesses.length > 0 && (
        <div className="pg-msg">
          Found running databases in Docker{guesses.length > 1 ? " — pick one:" : ":"}
          <div className="pg-row" style={{ flexWrap: "wrap", marginTop: 6 }}>
            {guesses.map((g) => (
              <button key={g.container} type="button" className={picked === g.container ? "primary" : ""} onClick={() => apply(g)} title={`${g.image} · ${g.user}@localhost:${g.port}/${g.database}`}>
                {g.container} <small>{KIND_LABEL[g.kind]} :{g.port}</small>{g.inProject ? " ★" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      <label>Connection string <small className="faint">(optional, fills the fields below)</small>
        <input value={f.url} placeholder={URL_HINT[f.kind]} spellCheck={false}
          onChange={(e) => setF((x) => fromUrl(e.target.value, { ...x, url: e.target.value }))} />
      </label>
      <label>Name<input value={f.name} placeholder="Local dev" onChange={(e) => set("name", e.target.value)} /></label>
      <div className="pg-row">
        <label style={{ flex: 1 }}>Host<input value={f.host} onChange={(e) => set("host", e.target.value)} /></label>
        <label style={{ width: 90 }}>Port<input value={f.port} inputMode="numeric" onChange={(e) => set("port", Number(e.target.value.replace(/\D/g, "")) || 0)} /></label>
      </div>
      <div className="pg-row">
        <label style={{ flex: 1 }}>{redisKind ? "Database number" : f.kind === "mysql" ? "Database (optional)" : "Database"}<input value={f.database} placeholder={f.kind === "mysql" ? "all databases" : ""} onChange={(e) => set("database", redisKind ? e.target.value.replace(/\D/g, "") : e.target.value)} /></label>
        <label style={{ flex: 1 }}>User{redisKind && <small className="faint"> (optional)</small>}<input value={f.user} placeholder={redisKind ? "default" : ""} onChange={(e) => set("user", e.target.value)} /></label>
      </div>
      <label>Password<input type="password" value={f.password} autoComplete="off"
        placeholder={f.id ? "Leave empty to keep the saved password" : ""} onChange={(e) => set("password", e.target.value)} /></label>
      <label className="dk-check"><input type="checkbox" checked={f.ssl} onChange={(e) => set("ssl", e.target.checked)} /> Use SSL</label>
      <label className="dk-check"><input type="checkbox" checked={f.readOnly} onChange={(e) => set("readOnly", e.target.checked)} /> {redisKind ? "Read-only (only read commands, no delete)" : "Read-only session (blocks INSERT / UPDATE / DELETE / DDL)"}</label>
      {msg && <div className={"pg-msg" + (msg.bad ? " bad" : "")}>{msg.text}</div>}
      <div className="pg-row end">
        <button onClick={onCancel}>Cancel</button>
        <button onClick={test} disabled={busy}>Test</button>
        <button className="primary" onClick={save} disabled={busy}>Save</button>
      </div>
      <p className="faint pg-note">Passwords are stored in this app's data folder on your computer.</p>
    </div>
  );
}

export function DatabasePanel({ project, onClose, embedded, preset }: { project: { id: string; name: string }; onClose: () => void; embedded?: boolean; preset?: { container: string; n: number } }) {
  const [conns, setConns] = useState<Conn[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [active, setActive] = useState<string>("home");       // "home" is the connection list
  const [form, setForm] = useState<Form | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => call<Conn[]>("list").then((all) => { const c = all.filter((x) => x.project === project.id); setConns(c); setLoaded(true); return c; }), [project.id]);
  useEffect(() => { reload().then((c) => { if (!c.length) setForm(blank()); }).catch(() => setLoaded(true)); }, [reload]);

  // Asked to open a specific database container (Docker panel): reuse a saved connection to it, or start a new one filled in from the container.
  const [want, setWant] = useState<{ container: string; n: number } | undefined>();
  useEffect(() => {
    if (!preset) return;
    let live = true;
    Promise.all([reload(), api<{ kind: Kind; container: string; host: string; port: number; database: string; user: string }[]>("/api/db/detect", { project: project.id })]).then(([list, guesses]) => {
      if (!live) return;
      const g = guesses.find((x) => x.container === preset.container);
      const have = g && list.find((c) => c.kind === g.kind && c.port === g.port && c.database === g.database && c.user === g.user && ["localhost", "127.0.0.1"].includes(c.host));
      if (have) { setForm(null); connect(have.id); }
      else { setActive("home"); setWant(preset); setForm(blank()); }
    }).catch(() => {});
    return () => { live = false; };
  }, [preset?.n]);

  const connect = (id: string) => { setOpenIds((o) => (o.includes(id) ? o : [...o, id])); setActive(id); };
  const close = (id: string) => { setOpenIds((o) => o.filter((x) => x !== id)); setActive((a) => (a === id ? "home" : a)); };
  const remove = async (c: Conn) => { await call("delete", { id: c.id }); close(c.id); reload(); };
  const edit = (c: Conn) => setForm({ ...c, password: "", url: "" });

  return (
    <div className={embedded ? "pg-embed-root" : "modal-backdrop dk-backdrop"} onMouseDown={embedded ? undefined : (e) => e.target === e.currentTarget && onClose()}>
      <div className={embedded ? "pg-embed-panel" : "dk-panel"}>
        {!embedded && <div className="dk-head">
          <div className="dk-logo pg-logo"><Icon name="database" size={18} /></div>
          <div className="dk-title"><h3>Database</h3><small>{project.name}</small></div>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} title="Close"><Icon name="x" size={14} /></button>
        </div>}
        <div className="dk-tabs pg-conntabs">
          <button className={active === "home" ? "on" : ""} onClick={() => setActive("home")}><Icon name="database" size={13} /> Connections</button>
          {openIds.map((id) => {
            const c = conns.find((x) => x.id === id);
            return c && (
              <button key={id} className={active === id ? "on" : ""} onClick={() => setActive(id)} title={`${c.user}@${c.host}:${c.port}/${c.database}`}>
                <span className="pg-live" /> {c.name}
                <span className="pg-x" onClick={(e) => { e.stopPropagation(); close(id); }}><Icon name="x" size={11} /></span>
              </button>
            );
          })}
          <button onClick={() => { setActive("home"); setForm(blank()); }} title="New connection"><Icon name="plus" size={13} /></button>
        </div>
        <div className="dk-content">
          {/* every open connection stays mounted, so its query and tables survive switching tabs */}
          {openIds.map((id) => {
            const c = conns.find((x) => x.id === id);
            return c && <div key={id + JSON.stringify(c)} className="pg-pane" hidden={active !== id}>{c.kind === "redis" ? <RedisSession conn={c} onEdit={() => { setActive("home"); edit(c); }} /> : <Session conn={c} onEdit={() => { setActive("home"); edit(c); }} />}</div>;
          })}
          {active === "home" && (
            form ? (
              <div className="pg-scroll"><ConnForm key={want?.n ?? 0} want={want?.container} project={project.id} initial={form} onCancel={() => setForm(null)} onSaved={(c) => { setForm(null); reload().then(() => connect(c.id)); }} /></div>
            ) : (
              <div className="pg-scroll">
                <div className="pg-list">
                  {conns.map((c) => (
                    <div key={c.id} className="pg-card">
                      <div className="pg-cardmain" onDoubleClick={() => connect(c.id)}>
                        <b>{c.name}</b>
                        <small className="faint mono">{c.kind === "redis" ? `${c.host}:${c.port}/${c.database}` : `${c.user}@${c.host}:${c.port}/${c.database}`}</small>
                        <span><span className="dk-pill acc">{KIND_LABEL[c.kind]}</span>{c.readOnly && <span className="dk-pill">read-only</span>}{c.ssl && <span className="dk-pill">ssl</span>}{openIds.includes(c.id) && <span className="dk-pill ok">open</span>}</span>
                      </div>
                      <button className="primary" onClick={() => connect(c.id)}>Open</button>
                      <button onClick={() => edit(c)}>Edit</button>
                      <button className="danger" title="Delete connection" onClick={() => confirm(`Delete "${c.name}"?`) && remove(c)}><Icon name="trash" size={13} /></button>
                    </div>
                  ))}
                  {loaded && !conns.length && <div className="pg-empty muted">No connections yet.</div>}
                  <button className="pg-add" onClick={() => setForm(blank())}><Icon name="plus" size={14} /> New connection</button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
