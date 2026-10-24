import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SQL, RedisClient } from "bun";
import { DATA_DIR } from "./paths";

// Saved database connections (PostgreSQL, MySQL/MariaDB, Redis); each belongs to the folder (project) it was added from. Passwords are kept in
// the same data folder as the other settings and are never sent back to the window.
export type DbKind = "postgres" | "mysql" | "redis";
export type DbConn = { id: string; project: string; kind: DbKind; name: string; host: string; port: number; database: string; user: string; password: string; ssl: boolean; readOnly: boolean };
export type DbConnPublic = Omit<DbConn, "password"> & { hasPassword: boolean };
const KINDS: DbKind[] = ["postgres", "mysql", "redis"];
const LABEL: Record<DbKind, string> = { postgres: "PostgreSQL", mysql: "MySQL", redis: "Redis" };
// For Redis, `database` holds the logical database number ("0"); for MySQL it may be empty (all databases are listed).
const DEFAULTS: Record<DbKind, { port: number; database: string; user: string }> = {
  postgres: { port: 5432, database: "postgres", user: "postgres" },
  mysql: { port: 3306, database: "", user: "root" },
  redis: { port: 6379, database: "0", user: "" },
};

const FILE = join(DATA_DIR, "postgres.json"); // the original file name, so connections saved by earlier versions keep working
const MAX_ROWS = 1000;

const str = (v: unknown, d = "") => (typeof v === "string" ? v.trim() : d);
function clean(c: any, old?: DbConn): DbConn {
  const kind: DbKind = KINDS.includes(c?.kind) ? c.kind : old?.kind ?? "postgres";
  const d = DEFAULTS[kind];
  const port = Number(c?.port);
  const database = kind === "redis" ? String(Math.max(0, Math.min(255, parseInt(String(c?.database ?? "0"), 10) || 0)))
    : kind === "mysql" ? str(c?.database, "") : str(c?.database, d.database) || d.database;
  return {
    id: old?.id ?? (str(c?.id).slice(0, 40) || crypto.randomUUID().slice(0, 8)),
    project: old?.project ?? str(c?.project).slice(0, 80),
    kind,
    name: str(c?.name).slice(0, 80) || str(c?.database) || LABEL[kind],
    host: str(c?.host, "localhost") || "localhost",
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : d.port,
    database,
    user: kind === "redis" ? str(c?.user) : str(c?.user, d.user) || d.user,
    // an empty password on edit means "keep the saved one"
    password: typeof c?.password === "string" && c.password !== "" ? c.password : old?.password ?? "",
    ssl: c?.ssl === true,
    readOnly: c?.readOnly === true,
  };
}
const pub = ({ password, ...c }: DbConn): DbConnPublic => ({ ...c, hasPassword: password !== "" });

async function load(): Promise<DbConn[]> {
  try { return (JSON.parse(await readFile(FILE, "utf8")) as any[]).map((c) => clean(c)); } catch { return []; }
}
async function store(list: DbConn[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}

// One small pool per connection, created on first use and dropped when the connection is edited or removed.
const pools = new Map<string, { sql: SQL; key: string }>();
const rpools = new Map<string, { cli: RedisClient; key: string }>();
const keyOf = (c: DbConn) => JSON.stringify(c);
const sqlOptions = (c: DbConn, max: number) => ({
  adapter: c.kind as "postgres" | "mysql", hostname: c.host, port: c.port, database: c.database || undefined, username: c.user, password: c.password,
  tls: c.ssl, max, idleTimeout: 60, connectionTimeout: 10,
  // MySQL 8+ signs in with a key exchange that needs TLS or this flag; it is only switched on for this machine, never for a remote host.
  ...(c.kind === "mysql" && /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i.test(c.host) ? { allowPublicKeyRetrieval: true } : {}),
});
function open(c: DbConn): SQL {
  const have = pools.get(c.id);
  if (have && have.key === keyOf(c)) return have.sql;
  have?.sql.close().catch(() => {});
  const sql = new SQL({
    ...sqlOptions(c, c.kind === "mysql" && c.readOnly ? 1 : 3),
    ...(c.kind === "postgres" ? { connection: { statement_timeout: 60_000, application_name: "Vibecoder", ...(c.readOnly ? { default_transaction_read_only: "on" } : {}) } } : {}),
  });
  if (c.kind === "mysql" && c.readOnly) sql.unsafe("SET SESSION TRANSACTION READ ONLY").catch(() => {}); // plus the statement check in run()
  pools.set(c.id, { sql, key: keyOf(c) });
  return sql;
}
const redisUrl = (c: DbConn) => {
  const auth = c.password ? `${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@` : c.user ? `${encodeURIComponent(c.user)}@` : "";
  return `${c.ssl ? "rediss" : "redis"}://${auth}${c.host}:${c.port}/${c.database || 0}`;
};
const redisOpts = { connectionTimeout: 8000, idleTimeout: 0, autoReconnect: true, maxRetries: 3 };
async function redis(c: DbConn): Promise<RedisClient> {
  const have = rpools.get(c.id);
  if (have && have.key === keyOf(c)) { if (!have.cli.connected) await have.cli.connect(); return have.cli; }
  have?.cli.close();
  const cli = new RedisClient(redisUrl(c), { ...redisOpts, tls: c.ssl || undefined });
  rpools.set(c.id, { cli, key: keyOf(c) });
  await cli.connect();
  return cli;
}
const drop = (id: string) => { pools.get(id)?.sql.close().catch(() => {}); pools.delete(id); rpools.get(id)?.cli.close(); rpools.delete(id); };

const must = async (id: unknown): Promise<DbConn> => {
  const c = (await load()).find((x) => x.id === id);
  if (!c) throw new Error("Connection not found");
  return c;
};
const ident = (c: DbConn, s: unknown) => {
  if (typeof s !== "string" || !s || s.length > 200) throw new Error("Invalid name");
  return c.kind === "mysql" ? "`" + s.replaceAll("`", "``") + "`" : `"${s.replaceAll('"', '""')}"`;
};
const ph = (c: DbConn, n: number) => (c.kind === "mysql" ? "?" : "$" + n); // parameter placeholder

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
// MySQL has no per-session switch we can rely on through a pool, so a read-only connection also refuses anything but reads here.
const READ_ONLY_SQL = /^\s*(select|show|describe|desc|explain|with|use)\b/i;
const run = async (c: DbConn, query: string, params: unknown[] = []) => {
  if (c.kind === "mysql" && c.readOnly && !READ_ONLY_SQL.test(query)) throw new Error("This connection is read-only: only SELECT / SHOW / DESCRIBE / EXPLAIN are allowed");
  const t = Date.now();
  return shape(await open(c).unsafe(query, params as any[]), t);
};

// ---- Redis -------------------------------------------------------------------------------------------------------------------------------

// Commands a read-only Redis connection may run; commands that would hold the connection hostage are refused everywhere.
const REDIS_READ = new Set(("get mget strlen getrange exists type ttl pttl expiretime scan keys randomkey dbsize hget hgetall hmget hlen hkeys hvals hexists hscan hstrlen lrange llen lindex " +
  "smembers scard sismember smismember srandmember sscan zrange zrevrange zrangebyscore zrevrangebyscore zrangebylex zcard zscore zrank zrevrank zcount zscan xlen xrange xrevrange xinfo " +
  "info ping echo time memory object bitcount getbit pfcount lolwut command config.get").split(" "));
const REDIS_BLOCKED = new Set(["subscribe", "psubscribe", "ssubscribe", "monitor", "sync", "psync", "replicaof", "slaveof", "debug", "shutdown"]);

// redis-cli style splitting: spaces separate arguments, "double" and 'single' quotes group them, \n \t \" work inside double quotes.
function splitArgs(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    let cur = "";
    const q = line[i] === '"' || line[i] === "'" ? line[i++] : "";
    if (q) {
      while (i < line.length && line[i] !== q) {
        if (q === '"' && line[i] === "\\" && i + 1 < line.length) { i++; cur += ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[line[i]] ?? line[i]; }
        else cur += line[i];
        i++;
      }
      if (line[i] !== q) throw new Error("Unbalanced quotes");
      i++;
    } else while (i < line.length && !/\s/.test(line[i])) cur += line[i++];
    out.push(cur);
  }
  return out;
}
// Replies come back decoded; make them JSON-safe and bounded.
function reply(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("utf8");
  if (Array.isArray(v)) return depth > 4 ? "[…]" : v.slice(0, 5000).map((x) => reply(x, depth + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as object).slice(0, 5000).map(([k, x]) => [k, reply(x, depth + 1)]));
  return v;
}
const send = async (c: DbConn, cmd: string, args: (string | number)[] = []) => reply(await (await redis(c)).send(cmd, args.map(String)));
// Hashes may come back as a flat array or an object depending on the protocol; always return [field, value] pairs.
const pairs = (v: any): [string, unknown][] => (Array.isArray(v) ? Array.from({ length: Math.floor(v.length / 2) }, (_, i) => [String(v[i * 2]), v[i * 2 + 1]] as [string, unknown]) : Object.entries(v ?? {}));

async function redisApi(c: DbConn, act: string, body: any) {
  if (act === "rinfo") {
    const info = String(await send(c, "INFO"));
    const f = (k: string) => new RegExp(`^${k}:(.*)$`, "m").exec(info)?.[1]?.trim() ?? "";
    return { version: f("redis_version"), mode: f("redis_mode"), memory: f("used_memory_human"), clients: f("connected_clients"), uptimeDays: f("uptime_in_days"), keys: Number(await send(c, "DBSIZE")) };
  }
  if (act === "rkeys") {
    const pattern = str(body.pattern) || "*";
    const [next, keys] = (await send(c, "SCAN", [String(body.cursor || "0"), "MATCH", pattern, "COUNT", 300])) as [string, string[]];
    const list = (keys ?? []).slice(0, 300);
    const meta = await Promise.all(list.map(async (key) => ({ key, type: String(await send(c, "TYPE", [key])), ttl: Number(await send(c, "PTTL", [key])) })));
    return { cursor: String(next), keys: meta };
  }
  if (act === "rget") {
    const key = String(body.key ?? "");
    const type = String(await send(c, "TYPE", [key]));
    if (type === "none") throw new Error("Key not found (it may have expired)");
    const ttl = Number(await send(c, "PTTL", [key]));
    const LIM = 500;
    let size = 0, value: unknown = null;
    if (type === "string") { size = Number(await send(c, "STRLEN", [key])); value = await send(c, "GETRANGE", [key, 0, 200_000]); }
    else if (type === "hash") { size = Number(await send(c, "HLEN", [key])); value = pairs(size > LIM ? ((await send(c, "HSCAN", [key, 0, "COUNT", LIM])) as any)[1] : await send(c, "HGETALL", [key])).slice(0, LIM); }
    else if (type === "list") { size = Number(await send(c, "LLEN", [key])); value = await send(c, "LRANGE", [key, 0, LIM - 1]); }
    else if (type === "set") { size = Number(await send(c, "SCARD", [key])); value = size > LIM ? ((await send(c, "SSCAN", [key, 0, "COUNT", LIM])) as any)[1].slice(0, LIM) : await send(c, "SMEMBERS", [key]); }
    else if (type === "zset") { size = Number(await send(c, "ZCARD", [key])); const z = (await send(c, "ZRANGE", [key, 0, LIM - 1, "WITHSCORES"])) as any[]; value = Array.isArray(z?.[0]) ? z : pairs(z); }
    else if (type === "stream") { size = Number(await send(c, "XLEN", [key])); value = await send(c, "XREVRANGE", [key, "+", "-", "COUNT", 100]); }
    return { type, ttl, size, value, truncated: type !== "string" && size > (Array.isArray(value) ? value.length : LIM) };
  }
  if (act === "rdel") {
    if (c.readOnly) throw new Error("This connection is read-only");
    return { removed: Number(await send(c, "DEL", [String(body.key ?? "")])) };
  }
  if (act === "rexec") {
    const args = splitArgs(String(body.command ?? ""));
    if (!args.length) throw new Error("Empty command");
    const name = args[0].toLowerCase();
    if (REDIS_BLOCKED.has(name)) throw new Error(`${args[0].toUpperCase()} is not available here: it would keep the connection busy`);
    if (c.readOnly && !REDIS_READ.has(name)) throw new Error("This connection is read-only");
    const t = Date.now();
    return { reply: await send(c, args[0], args.slice(1)), ms: Date.now() - t };
  }
  throw new Error("Unknown action");
}

// ---- SQL (PostgreSQL / MySQL) --------------------------------------------------------------------------------------------------------------

const SYSTEM_MYSQL = "('mysql','information_schema','performance_schema','sys')";
async function sqlApi(c: DbConn, act: string, body: any) {
  const my = c.kind === "mysql";
  if (act === "tables") {
    if (my) {
      // a database named in the connection narrows the list to it; without one every user database shows
      return (await run(c, `
        select table_schema as \`schema\`, table_name as name,
               case table_type when 'BASE TABLE' then 'table' when 'VIEW' then 'view' else lower(table_type) end as kind,
               cast(coalesce(table_rows, 0) as signed) as \`rows\`
        from information_schema.tables
        where table_schema not in ${SYSTEM_MYSQL} ${c.database ? "and table_schema = ?" : ""}
        order by table_schema, table_name`, c.database ? [c.database] : [])).rows;
    }
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
    if (my) {
      const w = [schema, table];
      const columns = (await run(c, `
        select column_name as name, column_type as type, (is_nullable = 'YES') as nullable, column_default as \`default\`, (column_key = 'PRI') as pk, column_comment as comment
        from information_schema.columns where table_schema = ? and table_name = ? order by ordinal_position`, w)).rows
        .map((r) => ({ ...r, nullable: !!Number(r.nullable), pk: !!Number(r.pk), comment: r.comment || null }));
      const indexes = (await run(c, `
        select index_name as name, concat(if(non_unique = 0, 'UNIQUE ', ''), index_type, ' (', group_concat(column_name order by seq_in_index separator ', '), ')') as def
        from information_schema.statistics where table_schema = ? and table_name = ? group by index_name, non_unique, index_type order by index_name`, w)).rows;
      const constraints = (await run(c, `
        select tc.constraint_name as name, lower(tc.constraint_type) as type,
               coalesce((select group_concat(concat(k.column_name, if(k.referenced_table_name is null, '', concat(' → ', k.referenced_table_name, '(', k.referenced_column_name, ')'))) order by k.ordinal_position separator ', ')
                         from information_schema.key_column_usage k
                         where k.constraint_schema = tc.constraint_schema and k.table_name = tc.table_name and k.constraint_name = tc.constraint_name), '') as def
        from information_schema.table_constraints tc where tc.table_schema = ? and tc.table_name = ? order by tc.constraint_type, tc.constraint_name`, w)).rows;
      const [info] = (await run(c, `
        select concat(round((coalesce(data_length, 0) + coalesce(index_length, 0)) / 1024 / 1024, 2), ' MB') as size, cast(coalesce(table_rows, 0) as signed) as \`rows\`, nullif(table_comment, '') as comment
        from information_schema.tables where table_schema = ? and table_name = ?`, w)).rows;
      return { columns, indexes, constraints, ...info };
    }
    const qn = `${ident(c, schema)}.${ident(c, table)}`;
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
    const qn = `${ident(c, body.schema)}.${ident(c, body.table)}`;
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), MAX_ROWS), offset = Math.max(Number(body.offset) || 0, 0);
    const order = body.order ? ` order by ${ident(c, body.order)} ${body.dir === "desc" ? "desc" : "asc"}` : "";
    const filter = str(body.where) ? ` where ${str(body.where)}` : "";
    return await run(c, `select * from ${qn}${filter}${order} limit ${limit} offset ${offset}`);
  }
  if (act === "count") {
    const filter = str(body.where) ? ` where ${str(body.where)}` : "";
    const r = await run(c, `select count(*)${my ? "" : "::bigint"} as n from ${ident(c, body.schema)}.${ident(c, body.table)}${filter}`);
    return { count: Number(r.rows[0]?.n ?? 0) };
  }
  if (act === "query") {
    const sql = str(body.sql);
    if (!sql) throw new Error("Empty query");
    return await run(c, sql);
  }
  throw new Error("Unknown action");
}

export async function dbApi(act: string, method: string, body: any) {
  try { return await dbApiRaw(act, method, body); }
  catch (e: any) {
    if (e?.code === "ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED") throw new Error("MySQL only signs in over a secure connection to a remote host: tick “Use SSL” (or connect through localhost / a tunnel).");
    if (e?.message === "Connection closed") throw new Error("Redis closed the connection: check the password / user, the port, or tick “Use SSL” if the server requires it.");
    throw e;
  }
}
async function dbApiRaw(act: string, method: string, body: any) {
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
    if (c.kind === "redis") {
      const cli = new RedisClient(redisUrl(c), { ...redisOpts, autoReconnect: false, maxRetries: 0, tls: c.ssl || undefined });
      try {
        await cli.connect();
        const info = String(await cli.send("INFO", ["server"]));
        return { ok: true, version: "Redis " + (/redis_version:(.*)/.exec(info)?.[1]?.trim() ?? ""), database: "db" + c.database };
      } finally { cli.close(); }
    }
    const sql = new SQL(sqlOptions(c, 1));
    try {
      const [r] = (await sql.unsafe(c.kind === "mysql" ? "select version() as v, database() as db" : "select version() as v, current_database() as db")) as any[];
      return { ok: true, version: c.kind === "mysql" ? "MySQL " + String(r.v) : String(r.v).split(" on ")[0], database: r.db ?? "(no database selected)" };
    } finally { await sql.close().catch(() => {}); }
  }

  const c = await must(body?.id);
  return c.kind === "redis" ? redisApi(c, act, body) : sqlApi(c, act, body);
}
