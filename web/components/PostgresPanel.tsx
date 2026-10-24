import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

type Conn = { id: string; project: string; name: string; host: string; port: number; database: string; user: string; ssl: boolean; readOnly: boolean; hasPassword: boolean };
type Form = Omit<Conn, "id" | "hasPassword" | "project"> & { id?: string; password: string; url: string };
type TableRef = { schema: string; name: string; kind: string; rows: number };
type Result = { columns: string[]; rows: Record<string, any>[]; truncated: boolean; ms: number; count: number; command: string };
type Describe = {
  columns: { name: string; type: string; nullable: boolean; default: string | null; pk: boolean; comment: string | null }[];
  indexes: { name: string; def: string }[]; constraints: { name: string; type: string; def: string }[];
  size: string; rows: number; comment: string | null;
};

const call = <T = any,>(act: string, body: unknown = {}) => api<T>(`/api/pg/${act}`, { body });
const blank = (): Form => ({ name: "", host: "localhost", port: 5432, database: "postgres", user: "postgres", password: "", ssl: false, readOnly: false, url: "" });
const fmtN = (n: number) => n.toLocaleString("en-US");
const show = (v: any) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// postgres://user:pass@host:5432/db → form fields
function fromUrl(text: string, f: Form): Form {
  try {
    const u = new URL(text.trim());
    if (!/^postgres(ql)?:$/.test(u.protocol)) return f;
    return {
      ...f, host: u.hostname || f.host, port: Number(u.port) || 5432, database: decodeURIComponent(u.pathname.slice(1)) || f.database,
      user: decodeURIComponent(u.username) || f.user, password: decodeURIComponent(u.password) || f.password,
      ssl: /sslmode=(require|verify)/.test(u.search) || f.ssl, name: f.name || u.hostname,
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

function ConnForm({ project, initial, onSaved, onCancel }: { project: string; initial: Form; onSaved: (c: Conn) => void; onCancel: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const body = () => { const { url, ...rest } = f; return { ...rest, project }; };

  // A new connection starts filled from the project's running PostgreSQL container (the first match), with the others offered as chips.
  type Guess = { container: string; image: string; host: string; port: number; database: string; user: string; password: string; inProject: boolean };
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [picked, setPicked] = useState("");
  const apply = (g: Guess) => { setPicked(g.container); setF((x) => ({ ...x, name: g.container, host: g.host, port: g.port, database: g.database, user: g.user, password: g.password })); };
  useEffect(() => {
    if (initial.id) return;
    let live = true;
    api<Guess[]>("/api/pg/detect", { project }).then((list) => { if (live && list.length) { setGuesses(list); apply(list[0]); } }).catch(() => {});
    return () => { live = false; };
  }, []);

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
      {guesses.length > 0 && (
        <div className="pg-msg">
          Found running PostgreSQL in Docker{guesses.length > 1 ? " — pick one:" : ":"}
          <div className="pg-row" style={{ flexWrap: "wrap", marginTop: 6 }}>
            {guesses.map((g) => (
              <button key={g.container} type="button" className={picked === g.container ? "primary" : ""} onClick={() => apply(g)} title={`${g.image} · ${g.user}@localhost:${g.port}/${g.database}`}>
                {g.container} :{g.port}{g.inProject ? " ★" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      <label>Connection string <small className="faint">(optional, fills the fields below)</small>
        <input value={f.url} placeholder="postgres://user:password@host:5432/database" spellCheck={false}
          onChange={(e) => setF((x) => fromUrl(e.target.value, { ...x, url: e.target.value }))} />
      </label>
      <label>Name<input value={f.name} placeholder="Local dev" onChange={(e) => set("name", e.target.value)} /></label>
      <div className="pg-row">
        <label style={{ flex: 1 }}>Host<input value={f.host} onChange={(e) => set("host", e.target.value)} /></label>
        <label style={{ width: 90 }}>Port<input value={f.port} inputMode="numeric" onChange={(e) => set("port", Number(e.target.value.replace(/\D/g, "")) || 0)} /></label>
      </div>
      <div className="pg-row">
        <label style={{ flex: 1 }}>Database<input value={f.database} onChange={(e) => set("database", e.target.value)} /></label>
        <label style={{ flex: 1 }}>User<input value={f.user} onChange={(e) => set("user", e.target.value)} /></label>
      </div>
      <label>Password<input type="password" value={f.password} autoComplete="off"
        placeholder={f.id ? "Leave empty to keep the saved password" : ""} onChange={(e) => set("password", e.target.value)} /></label>
      <label className="dk-check"><input type="checkbox" checked={f.ssl} onChange={(e) => set("ssl", e.target.checked)} /> Use SSL</label>
      <label className="dk-check"><input type="checkbox" checked={f.readOnly} onChange={(e) => set("readOnly", e.target.checked)} /> Read-only session (blocks INSERT / UPDATE / DELETE / DDL)</label>
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

export function PostgresPanel({ project, onClose }: { project: { id: string; name: string }; onClose: () => void }) {
  const [conns, setConns] = useState<Conn[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [active, setActive] = useState<string>("home");       // "home" is the connection list
  const [form, setForm] = useState<Form | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => call<Conn[]>("list").then((all) => { const c = all.filter((x) => x.project === project.id); setConns(c); setLoaded(true); return c; }), [project.id]);
  useEffect(() => { reload().then((c) => { if (!c.length) setForm(blank()); }).catch(() => setLoaded(true)); }, [reload]);

  const connect = (id: string) => { setOpenIds((o) => (o.includes(id) ? o : [...o, id])); setActive(id); };
  const close = (id: string) => { setOpenIds((o) => o.filter((x) => x !== id)); setActive((a) => (a === id ? "home" : a)); };
  const remove = async (c: Conn) => { await call("delete", { id: c.id }); close(c.id); reload(); };
  const edit = (c: Conn) => setForm({ ...c, password: "", url: "" });

  return (
    <div className="modal-backdrop dk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dk-panel">
        <div className="dk-head">
          <div className="dk-logo pg-logo"><Icon name="database" size={18} /></div>
          <div className="dk-title"><h3>PostgreSQL</h3><small>{project.name}</small></div>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} title="Close"><Icon name="x" size={14} /></button>
        </div>
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
            return c && <div key={id + JSON.stringify(c)} className="pg-pane" hidden={active !== id}><Session conn={c} onEdit={() => { setActive("home"); edit(c); }} /></div>;
          })}
          {active === "home" && (
            form ? (
              <div className="pg-scroll"><ConnForm project={project.id} initial={form} onCancel={() => setForm(null)} onSaved={(c) => { setForm(null); reload().then(() => connect(c.id)); }} /></div>
            ) : (
              <div className="pg-scroll">
                <div className="pg-list">
                  {conns.map((c) => (
                    <div key={c.id} className="pg-card">
                      <div className="pg-cardmain" onDoubleClick={() => connect(c.id)}>
                        <b>{c.name}</b>
                        <small className="faint mono">{c.user}@{c.host}:{c.port}/{c.database}</small>
                        <span>{c.readOnly && <span className="dk-pill">read-only</span>}{c.ssl && <span className="dk-pill">ssl</span>}{openIds.includes(c.id) && <span className="dk-pill ok">open</span>}</span>
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
