import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SQL } from "bun";
import { DATA_DIR } from "./paths";

// Saved PostgreSQL connections; each belongs to the folder (project) it was added from. Passwords are kept in the same data folder as the other
// settings and are never sent back to the window.
export type PgConn = { id: string; project: string; name: string; host: string; port: number; database: string; user: string; password: string; ssl: boolean; readOnly: boolean };
export type PgConnPublic = Omit<PgConn, "password"> & { hasPassword: boolean };

const FILE = join(DATA_DIR, "postgres.json");
const MAX_ROWS = 1000;

const str = (v: unknown, d = "") => (typeof v === "string" ? v.trim() : d);
function clean(c: any, old?: PgConn): PgConn {
  const port = Number(c?.port);
  return {
    id: old?.id ?? (str(c?.id).slice(0, 40) || crypto.randomUUID().slice(0, 8)),
    project: old?.project ?? str(c?.project).slice(0, 80),
    name: str(c?.name).slice(0, 80) || str(c?.database) || "Postgres",
    host: str(c?.host, "localhost") || "localhost",
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 5432,
    database: str(c?.database, "postgres") || "postgres",
    user: str(c?.user, "postgres") || "postgres",
    // an empty password on edit means "keep the saved one"
    password: typeof c?.password === "string" && c.password !== "" ? c.password : old?.password ?? "",
    ssl: c?.ssl === true,
    readOnly: c?.readOnly === true,
  };
}
const pub = ({ password, ...c }: PgConn): PgConnPublic => ({ ...c, hasPassword: password !== "" });

async function load(): Promise<PgConn[]> {
  try { return (JSON.parse(await readFile(FILE, "utf8")) as any[]).map((c) => clean(c)); } catch { return []; }
}
async function store(list: PgConn[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}

// One small pool per connection, created on first use and dropped when the connection is edited or removed.
const pools = new Map<string, { sql: SQL; key: string }>();
const keyOf = (c: PgConn) => JSON.stringify(c);
function open(c: PgConn): SQL {
  const have = pools.get(c.id);
  if (have && have.key === keyOf(c)) return have.sql;
  have?.sql.close().catch(() => {});
  const sql = new SQL({
    hostname: c.host, port: c.port, database: c.database, username: c.user, password: c.password,
    tls: c.ssl, max: 3, idleTimeout: 60, connectionTimeout: 10,
    connection: { statement_timeout: 60_000, application_name: "Vibecoder", ...(c.readOnly ? { default_transaction_read_only: "on" } : {}) },
  });
  pools.set(c.id, { sql, key: keyOf(c) });
  return sql;
}
const drop = (id: string) => { pools.get(id)?.sql.close().catch(() => {}); pools.delete(id); };

const must = async (id: unknown): Promise<PgConn> => {
  const c = (await load()).find((x) => x.id === id);
  if (!c) throw new Error("Connection not found");
  return c;
};
const ident = (s: unknown) => {
  if (typeof s !== "string" || !s || s.length > 200) throw new Error("Invalid name");
  return `"${s.replaceAll('"', '""')}"`;
};

// Turn driver values into something JSON can carry.
function cell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (v instanceof Uint8Array) return "\\x" + Buffer.from(v).toString("hex").slice(0, 400);
  if (Array.isArray(v) || typeof v === "object") return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
  return v;
}
function shape(res: any, started: number) {
  const all: any[] = Array.isArray(res) ? res : [];
  const truncated = all.length > MAX_ROWS;
  const rows = all.slice(0, MAX_ROWS).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
  const cols: string[] = Array.isArray(res?.columns) && res.columns.length ? res.columns.map((c: any) => c.name ?? String(c)) : Object.keys(all[0] ?? {});
  return {
    columns: cols, rows, truncated, ms: Date.now() - started,
    count: typeof res?.count === "number" ? res.count : all.length, command: typeof res?.command === "string" ? res.command : "",
  };
}
const run = async (c: PgConn, query: string, params: unknown[] = []) => {
  const t = Date.now();
  return shape(await open(c).unsafe(query, params as any[]), t);
};

export async function pgApi(act: string, method: string, body: any) {
  if (act === "list") return (await load()).map(pub);
  if (act === "save") {
    const list = await load();
    const old = list.find((x) => x.id === body?.id);
    const c = clean(body, old);
    await store(old ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]);
    drop(c.id);
    return pub(c);
  }
  if (act === "delete") {
    drop(String(body?.id));
    await store((await load()).filter((x) => x.id !== body?.id));
    return { ok: true };
  }
  if (act === "test") {
    // an unsaved form is tested as typed; with an id and no password it reuses the saved one
    const c = clean(body, body?.id ? (await load()).find((x) => x.id === body.id) : undefined);
    const sql = new SQL({ hostname: c.host, port: c.port, database: c.database, username: c.user, password: c.password, tls: c.ssl, max: 1, connectionTimeout: 8 });
    try {
      const [r] = (await sql.unsafe("select version() as v, current_database() as db")) as any[];
      return { ok: true, version: String(r.v).split(" on ")[0], database: r.db };
    } finally { await sql.close().catch(() => {}); }
  }

  const c = await must(body?.id);
  if (act === "tables") {
    // user schemas only; row counts are the planner's estimate so a huge table never slows the list down
    return (await run(c, `
      select n.nspname as schema, c.relname as name,
             case c.relkind when 'r' then 'table' when 'p' then 'table' when 'v' then 'view' when 'm' then 'matview' when 'f' then 'foreign' end as kind,
             greatest(c.reltuples, 0)::bigint as rows
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg\\_toast%'
      order by n.nspname, c.relname`)).rows;
  }
  if (act === "describe") {
    const schema = String(body.schema), table = String(body.table);
    const qn = `${ident(schema)}.${ident(table)}`;
    const columns = (await run(c, `
      select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
             pg_get_expr(d.adbin, d.adrelid) as "default", coalesce(i.indisprimary, false) as pk,
             col_description(a.attrelid, a.attnum) as comment
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      left join pg_index i on i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey)
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum`, [qn])).rows;
    const indexes = (await run(c, `select indexname as name, indexdef as def from pg_indexes where schemaname = $1 and tablename = $2 order by indexname`, [schema, table])).rows;
    const constraints = (await run(c, `
      select conname as name, case contype when 'p' then 'primary key' when 'f' then 'foreign key' when 'u' then 'unique' when 'c' then 'check' else contype::text end as type,
             pg_get_constraintdef(oid) as def
      from pg_constraint where conrelid = $1::regclass order by contype, conname`, [qn])).rows;
    const [info] = (await run(c, `
      select pg_size_pretty(pg_total_relation_size($1::regclass)) as size, greatest(reltuples, 0)::bigint as rows, obj_description($1::regclass) as comment
      from pg_class where oid = $1::regclass`, [qn])).rows;
    return { columns, indexes, constraints, ...info };
  }
  if (act === "rows") {
    const qn = `${ident(body.schema)}.${ident(body.table)}`;
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), MAX_ROWS), offset = Math.max(Number(body.offset) || 0, 0);
    const order = body.order ? ` order by ${ident(body.order)} ${body.dir === "desc" ? "desc" : "asc"}` : "";
    const filter = str(body.where) ? ` where ${str(body.where)}` : "";
    return await run(c, `select * from ${qn}${filter}${order} limit ${limit} offset ${offset}`);
  }
  if (act === "count") {
    const filter = str(body.where) ? ` where ${str(body.where)}` : "";
    const r = await run(c, `select count(*)::bigint as n from ${ident(body.schema)}.${ident(body.table)}${filter}`);
    return { count: Number(r.rows[0]?.n ?? 0) };
  }
  if (act === "query") {
    const sql = str(body.sql);
    if (!sql) throw new Error("Empty query");
    return await run(c, sql);
  }
  throw new Error("Unknown action");
}
