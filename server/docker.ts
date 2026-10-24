import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Docker is driven through its CLI (JSON output), so it works with Docker Desktop, OrbStack, Colima and plain Engine alike.
// A Finder-launched app has a minimal PATH, so the usual install locations are searched as well.
const EXTRA_DIRS = [
  "/usr/local/bin", "/opt/homebrew/bin", "/Applications/Docker.app/Contents/Resources/bin",
  join(homedir(), ".docker/bin"), join(homedir(), ".orbstack/bin"), join(homedir(), ".rd/bin"), "/usr/bin",
];
const WIN = process.platform === "win32";
const winDirs = () => [join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin")];
const searchDirs = () => [...new Set([...(process.env.PATH ?? "").split(WIN ? ";" : ":").filter(Boolean), ...(WIN ? winDirs() : EXTRA_DIRS)])];

let found: string | undefined;
export function dockerBin(): string | null {
  if (found && existsSync(found)) return found;
  found = searchDirs().map((d) => join(d, WIN ? "docker.exe" : "docker")).find((f) => existsSync(f));
  return found ?? null;
}
export const dockerEnv = () => ({ ...process.env, PATH: searchDirs().join(WIN ? ";" : ":") });

const NAME = /^[\w][\w.\-:/@]*$/;                       // container / image / volume / network references
const checkName = (s: unknown): string => {
  if (typeof s !== "string" || !NAME.test(s)) throw new Error("Invalid name");
  return s;
};
export const isContainerRef = (s: unknown): s is string => typeof s === "string" && NAME.test(s);

type Run = { ok: boolean; out: string; err: string };
async function run(args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<Run> {
  const bin = dockerBin();
  if (!bin) throw new Error("Docker is not installed");
  const proc = Bun.spawn([bin, ...args], { cwd: opts.cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: dockerEnv() });
  const timer = setTimeout(() => proc.kill(), opts.timeout ?? 20_000);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  return { ok: code === 0, out, err };
}
const must = async (args: string[], opts?: { cwd?: string; timeout?: number }) => {
  const r = await run(args, opts);
  if (!r.ok) throw new Error(r.err.trim().split("\n").filter(Boolean).slice(-3).join("\n") || `docker ${args[0]} failed`);
  return r.out;
};
const rows = (s: string): any[] => s.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

// "a=b,c=d" → object. A compose label can itself contain commas (several config files), so a piece without "=" belongs to the previous value.
function parseLabels(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  let last = "";
  for (const part of (s ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i > 0 && /^[\w.\-/]+$/.test(part.slice(0, i))) { last = part.slice(0, i); out[last] = part.slice(i + 1); }
    else if (last) out[last] += "," + part;
  }
  return out;
}

export type Port = { host?: number; container: number; proto: string };
function parsePorts(s: string | undefined): Port[] {
  const seen = new Set<string>();
  const list: Port[] = [];
  for (const seg of (s ?? "").split(", ").filter(Boolean)) {
    const pub = seg.match(/^(?:.*):(\d+)(?:-\d+)?->(\d+)(?:-\d+)?\/(\w+)$/);
    const exp = seg.match(/^(\d+)(?:-\d+)?\/(\w+)$/);
    const port: Port | null = pub ? { host: +pub[1], container: +pub[2], proto: pub[3] } : exp ? { container: +exp[1], proto: exp[2] } : null;
    if (!port) continue;
    const key = `${port.host ?? ""}:${port.container}/${port.proto}`;
    if (!seen.has(key)) { seen.add(key); list.push(port); }
  }
  return list;
}

const num = (s: string | undefined) => { const n = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

async function containers() {
  const list = rows(await must(["ps", "-a", "--no-trunc", "--format", "{{json .}}"]));
  return list.map((c) => {
    const labels = parseLabels(c.Labels);
    const status: string = c.Status ?? "";
    const health = /\(unhealthy\)/.test(status) ? "unhealthy" : /\(healthy\)/.test(status) ? "healthy" : /health: starting/.test(status) ? "starting" : null;
    const exit = status.match(/^Exited \((-?\d+)\)/);
    const project = labels["com.docker.compose.project"];
    return {
      id: String(c.ID).slice(0, 12),
      name: String(c.Names).split(",")[0],
      image: c.Image as string,
      state: c.State as string,
      status,
      health,
      exitCode: exit ? +exit[1] : null,
      ports: parsePorts(c.Ports),
      created: c.CreatedAt as string,
      runningFor: c.RunningFor as string,
      mounts: String(c.Mounts ?? "").split(",").filter(Boolean),
      networks: String(c.Networks ?? "").split(",").filter(Boolean),
      command: String(c.Command ?? "").replace(/^"|"$/g, ""),
      compose: project
        ? {
            project,
            service: labels["com.docker.compose.service"] ?? "",
            dir: labels["com.docker.compose.project.working_dir"] ?? "",
            files: (labels["com.docker.compose.project.config_files"] ?? "").split(",").filter(Boolean),
          }
        : null,
    };
  });
}

async function overview(root: string) {
  const [cs, imgs, vols, nets] = await Promise.all([
    containers(),
    must(["images", "--format", "{{json .}}"]).then(rows),
    must(["volume", "ls", "--format", "{{json .}}"]).then(rows),
    must(["network", "ls", "--format", "{{json .}}"]).then(rows),
  ]);
  const images = imgs.map((i) => {
    const ref = i.Tag && i.Tag !== "<none>" ? `${i.Repository}:${i.Tag}` : i.Repository;
    return {
      id: String(i.ID).replace(/^sha256:/, "").slice(0, 12), repository: i.Repository as string, tag: i.Tag as string,
      ref, size: i.Size as string, created: i.CreatedSince as string, dangling: i.Repository === "<none>",
      usedBy: cs.filter((c) => c.image === ref || c.image === i.Repository || String(i.ID).replace(/^sha256:/, "").startsWith(c.image)).map((c) => c.name),
    };
  });
  const volumes = vols.map((v) => ({ name: v.Name as string, driver: v.Driver as string, scope: v.Scope as string, usedBy: cs.filter((c) => c.mounts.includes(v.Name)).map((c) => c.name) }));
  const networks = nets.map((n) => ({
    id: String(n.ID).slice(0, 12), name: n.Name as string, driver: n.Driver as string, scope: n.Scope as string,
    builtin: ["bridge", "host", "none"].includes(n.Name), usedBy: cs.filter((c) => c.networks.includes(n.Name)).map((c) => c.name),
  }));
  return { containers: cs, images, volumes, networks, root, composeFile: composeFileIn(root) };
}

const COMPOSE_NAMES = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];
const composeFileIn = (root: string) => COMPOSE_NAMES.find((n) => existsSync(join(root, n))) ?? null;

// `docker stats` takes a second or two; share one call between callers and keep it for a moment.
let statsCache: { at: number; value: unknown } | undefined;
let statsInflight: Promise<unknown> | undefined;
function stats() {
  if (statsCache && Date.now() - statsCache.at < 2500) return Promise.resolve(statsCache.value);
  statsInflight ??= must(["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 20_000 })
    .then((out) => {
      const value = Object.fromEntries(rows(out).map((s) => [String(s.ID).slice(0, 12), {
        cpu: num(s.CPUPerc), memPct: num(s.MemPerc), mem: s.MemUsage as string, net: s.NetIO as string, block: s.BlockIO as string, pids: num(s.PIDs),
      }]));
      statsCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => { statsInflight = undefined; });
  return statsInflight;
}

let dfCache: { at: number; value: unknown } | undefined;
async function df() {
  if (dfCache && Date.now() - dfCache.at < 20_000) return dfCache.value;
  const value = rows(await must(["system", "df", "--format", "{{json .}}"], { timeout: 30_000 }))
    .map((r) => ({ type: r.Type as string, total: num(r.TotalCount), active: num(r.Active), size: r.Size as string, reclaimable: r.Reclaimable as string }));
  dfCache = { at: Date.now(), value };
  return value;
}

async function status() {
  if (!dockerBin()) return { state: "missing" as const };
  const r = await run(["info", "--format", "{{json .}}"], { timeout: 6000 }).catch(() => null);
  let info: any;
  try { info = r ? JSON.parse(r.out) : null; } catch { info = null; }
  if (!r?.ok || !info?.ServerVersion) {
    const msg = (r?.err ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
    return { state: "stopped" as const, error: msg };
  }
  return {
    state: "running" as const, version: info.ServerVersion as string, os: info.OperatingSystem as string, cpus: info.NCPU as number, memory: info.MemTotal as number,
    containers: info.Containers as number, running: info.ContainersRunning as number, paused: info.ContainersPaused as number, stopped: info.ContainersStopped as number, images: info.Images as number,
    context: info.Name as string,
  };
}

async function inspect(id: string) {
  const [c] = JSON.parse(await must(["inspect", checkName(id)]));
  if (!c) throw new Error("Container not found");
  const cfg = c.Config ?? {}, st = c.State ?? {}, host = c.HostConfig ?? {};
  return {
    image: cfg.Image as string, imageId: String(c.Image ?? "").replace(/^sha256:/, "").slice(0, 12), platform: c.Platform as string,
    created: c.Created as string, startedAt: st.StartedAt as string, finishedAt: st.FinishedAt as string,
    exitCode: st.ExitCode as number, oomKilled: !!st.OOMKilled, error: (st.Error as string) || "", pid: st.Pid as number,
    restartCount: c.RestartCount as number, restartPolicy: host.RestartPolicy?.Name || "no",
    cmd: [...(cfg.Entrypoint ?? []), ...(cfg.Cmd ?? [])].join(" "), workdir: cfg.WorkingDir as string, user: cfg.User as string,
    env: (cfg.Env ?? []) as string[],
    mounts: (c.Mounts ?? []).map((m: any) => ({ type: m.Type, source: m.Source, destination: m.Destination, rw: m.RW, name: m.Name })),
    networks: Object.entries(c.NetworkSettings?.Networks ?? {}).map(([name, n]: [string, any]) => ({ name, ip: n.IPAddress, gateway: n.Gateway, mac: n.MacAddress, aliases: n.Aliases ?? [] })),
    health: st.Health ? { status: st.Health.Status, streak: st.Health.FailingStreak, log: (st.Health.Log ?? []).slice(-3).map((l: any) => ({ exit: l.ExitCode, out: String(l.Output ?? "").trim().slice(0, 300), end: l.End })) } : null,
    limits: { memory: host.Memory as number, cpus: host.NanoCpus ? host.NanoCpus / 1e9 : 0 },
    privileged: !!host.Privileged,
    labels: (cfg.Labels ?? {}) as Record<string, string>,
  };
}

const CONTAINER_ACTIONS: Record<string, string[]> = {
  start: ["start"], stop: ["stop"], restart: ["restart"], pause: ["pause"], unpause: ["unpause"], kill: ["kill"], remove: ["rm", "-f"],
};
const PRUNE: Record<string, string[]> = {
  containers: ["container", "prune", "-f"], images: ["image", "prune", "-f"], "images-all": ["image", "prune", "-a", "-f"],
  volumes: ["volume", "prune", "-f"], networks: ["network", "prune", "-f"], builder: ["builder", "prune", "-f"],
};
const COMPOSE_ACTIONS: Record<string, string[]> = {
  up: ["up", "-d"], "up-build": ["up", "-d", "--build"], down: ["down"], stop: ["stop"], start: ["start"], restart: ["restart"], pull: ["pull"], build: ["build"],
};

const tail = (s: string, n = 6) => s.trim().split("\n").filter(Boolean).slice(-n).join("\n");

// Routes under /api/docker/*. `root` is the focused project's folder (its compose file is the one `up` runs).
export async function dockerApi(path: string, method: string, q: URLSearchParams, body: () => Promise<any>, root: string): Promise<unknown> {
  const bust = () => { statsCache = undefined; dfCache = undefined; };
  if (path === "status") return status();
  if (path === "overview") return overview(root);
  if (path === "stats") return stats();
  if (path === "df") return df();
  if (path === "inspect") return inspect(q.get("id") ?? "");
  if (method !== "POST") throw new Error("not found");
  const b = await body();

  if (path === "launch") {                                  // start Docker Desktop (macOS)
    if (process.platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", "", join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe")], { stdout: "ignore", stderr: "ignore" });
      return { ok: true };
    }
    if (process.platform !== "darwin") throw new Error("Start Docker manually");
    Bun.spawn(["open", "-a", "Docker"], { stdout: "ignore", stderr: "ignore" });
    return { ok: true };
  }

  if (path === "container") {
    const args = CONTAINER_ACTIONS[b.action];
    if (!args) throw new Error("Unknown action");
    await must([...args, checkName(b.id)], { timeout: 60_000 });
    bust();
    return { ok: true };
  }
  if (path === "image") {
    if (b.action === "remove") await must(["rmi", checkName(b.name)], { timeout: 60_000 });
    else if (b.action === "pull") await must(["pull", checkName(b.name)], { timeout: 600_000 });
    else throw new Error("Unknown action");
    bust();
    return { ok: true };
  }
  if (path === "volume") { await must(["volume", "rm", checkName(b.name)]); bust(); return { ok: true }; }
  if (path === "network") { await must(["network", "rm", checkName(b.name)]); bust(); return { ok: true }; }
  if (path === "prune") {
    const args = PRUNE[b.kind];
    if (!args) throw new Error("Unknown prune target");
    const out = await must(args, { timeout: 120_000 });
    bust();
    return { out: tail(out, 2) };
  }
  if (path === "compose") {
    const act = COMPOSE_ACTIONS[b.action];
    if (!act) throw new Error("Unknown action");
    const args = ["compose"];
    let cwd = root;
    if (b.name) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(b.name)) throw new Error("Invalid compose project name");
      args.push("-p", b.name);
      if (typeof b.dir === "string" && b.dir && existsSync(b.dir)) { args.push("--project-directory", b.dir); cwd = b.dir; }
      for (const f of Array.isArray(b.files) ? b.files : []) if (typeof f === "string" && existsSync(f)) args.push("-f", f);
    } else if (!composeFileIn(root)) throw new Error("This project has no compose file");
    const out = await must([...args, ...act], { cwd, timeout: 600_000 });
    bust();
    return { out: tail(out) };
  }
  throw new Error("not found");
}

// Live `docker logs -f` streams, one set per WebSocket.
export function makeDockerLogs(send: (m: unknown) => void) {
  const procs = new Map<string, ReturnType<typeof Bun.spawn>>();
  const close = (id: string) => { procs.get(id)?.kill(); procs.delete(id); };
  return {
    open(id: string, container: string, tailLines: number) {
      close(id);
      const bin = dockerBin();
      if (!bin || !isContainerRef(container)) return send({ type: "docker-log-end", id });
      const n = Math.max(0, Math.min(5000, Math.floor(tailLines) || 300));
      const proc = Bun.spawn([bin, "logs", "-f", "--timestamps", "--tail", String(n), container], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: dockerEnv() });
      procs.set(id, proc);
      const pump = async (s: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder();
        for await (const chunk of s) send({ type: "docker-log", id, data: dec.decode(chunk, { stream: true }) });
      };
      void Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>)]).catch(() => {});
      void proc.exited.then(() => { if (procs.get(id) === proc) { procs.delete(id); send({ type: "docker-log-end", id }); } });
    },
    close,
    closeAll: () => [...procs.keys()].forEach(close),
  };
}

// Running database containers (PostgreSQL, MySQL/MariaDB, Redis), with the credentials from their environment and the port published on this machine.
// Containers whose compose folder lies inside the project come first, so a click on "database" lands on the project's own DB.
export type DbGuess = { kind: "postgres" | "mysql" | "redis"; container: string; image: string; host: string; port: number; database: string; user: string; password: string; inProject: boolean };
const IMAGE_KIND: [DbGuess["kind"], RegExp, number][] = [
  ["postgres", /postgres|postgis|timescale|pgvector/i, 5432],
  ["mysql", /mysql|mariadb|percona/i, 3306],
  ["redis", /redis|valkey|keydb/i, 6379],
];
export const dbKindOfImage = (image: string) => IMAGE_KIND.find(([, re]) => re.test(image))?.[0];
export async function detectDatabases(root: string): Promise<DbGuess[]> {
  if (!dockerBin()) return [];
  const ps = rows(await must(["ps", "--no-trunc", "--format", "{{json .}}"]).catch(() => ""));
  const ids = ps.filter((c) => dbKindOfImage(String(c.Image))).map((c) => String(c.ID));
  if (!ids.length) return [];
  const info: any[] = JSON.parse((await must(["inspect", ...ids]).catch(() => "[]")) || "[]");
  const norm = (d: string) => d.replace(/\/+$/, "");
  const out: DbGuess[] = [];
  for (const c of info) {
    const image = String(c.Config?.Image ?? "");
    const hit = IMAGE_KIND.find(([, re]) => re.test(image));
    if (!hit) continue;
    const [kind, , inner] = hit;
    const env: Record<string, string> = Object.fromEntries((c.Config?.Env ?? []).map((e: string) => { const i = e.indexOf("="); return [e.slice(0, i), e.slice(i + 1)]; }));
    const bound = c.NetworkSettings?.Ports?.[`${inner}/tcp`]?.[0]?.HostPort;
    if (!bound) continue; // not reachable from this machine
    const dir = norm(c.Config?.Labels?.["com.docker.compose.project.working_dir"] ?? "");
    let user = "", password = "", database = "";
    if (kind === "postgres") {
      user = env.POSTGRES_USER || env.POSTGRESQL_USERNAME || "postgres";
      password = env.POSTGRES_PASSWORD || env.POSTGRESQL_PASSWORD || "";
      database = env.POSTGRES_DB || env.POSTGRESQL_DATABASE || user;
    } else if (kind === "mysql") {
      const app = env.MYSQL_USER || env.MARIADB_USER;
      user = app || "root";
      password = app ? env.MYSQL_PASSWORD || env.MARIADB_PASSWORD || "" : env.MYSQL_ROOT_PASSWORD || env.MARIADB_ROOT_PASSWORD || "";
      database = env.MYSQL_DATABASE || env.MARIADB_DATABASE || "";
    } else {
      // the password usually comes from the start command (--requirepass x) or a bitnami-style variable
      const cmd = [...(c.Config?.Entrypoint ?? []), ...(c.Config?.Cmd ?? [])].join(" ");
      password = env.REDIS_PASSWORD || /--requirepass\s+("[^"]*"|'[^']*'|\S+)/.exec(cmd)?.[1]?.replace(/^["']|["']$/g, "") || "";
      database = "0";
    }
    out.push({
      kind, container: String(c.Name ?? "").replace(/^\//, ""), image, host: "localhost", port: Number(bound), database, user, password,
      inProject: !!dir && (dir === norm(root) || dir.startsWith(norm(root) + "/")),
    });
  }
  return out.sort((a, b) => Number(b.inProject) - Number(a.inProject));
}
