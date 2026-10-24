import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { DockerDetail, stateTone, type Container, type Stat } from "./DockerDetail";

export type DockerStatus =
  | { state: "missing" }
  | { state: "stopped"; error: string }
  | { state: "running"; version: string; os: string; cpus: number; memory: number; containers: number; running: number; paused: number; stopped: number; images: number; context: string };

type Image = { id: string; repository: string; tag: string; ref: string; size: string; created: string; dangling: boolean; usedBy: string[] };
type Volume = { name: string; driver: string; scope: string; usedBy: string[] };
type Network = { id: string; name: string; driver: string; scope: string; builtin: boolean; usedBy: string[] };
type Overview = { containers: Container[]; images: Image[]; volumes: Volume[]; networks: Network[]; root: string; composeFile: string | null };
type Df = { type: string; total: number; active: number; size: string; reclaimable: string }[];
type Tab = "containers" | "images" | "volumes" | "networks";

const UNITS: Record<string, number> = { b: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 2 ** 20, gb: 1e9, gib: 2 ** 30, tb: 1e12, tib: 2 ** 40 };
const toBytes = (s: string) => {
  const m = s.trim().match(/^([\d.]+)\s*([a-z]+)$/i);
  return m ? parseFloat(m[1]) * (UNITS[m[2].toLowerCase()] ?? 1) : 0;
};
const fmtBytes = (n: number) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : n >= 2 ** 20 ? `${Math.round(n / 2 ** 20)} MB` : `${Math.round(n / 1024)} KB`);

// Poll `fn` every `ms` while the window is visible; the first run is immediate.
function usePoll(fn: () => void, ms: number, on: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on) return;
    ref.current();
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

function Spark({ data, tone }: { data: number[]; tone: string }) {
  if (data.length < 2) return <svg className="dk-spark" viewBox="0 0 100 28" />;
  const max = Math.max(...data, 1e-9);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${26 - (v / max) * 24}`);
  return (
    <svg className={"dk-spark " + tone} viewBox="0 0 100 28" preserveAspectRatio="none">
      <polygon points={`0,28 ${pts.join(" ")} 100,28`} className="fill" />
      <polyline points={pts.join(" ")} className="line" />
    </svg>
  );
}

// Two-click button: the first click arms it ("Sure?"), the second runs it. Disarms itself after a few seconds.
function Confirm({ label, armed, onConfirm, icon, title, disabled }: { label: string; armed?: string; onConfirm: () => void; icon?: "trash"; title?: string; disabled?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => { if (!on) return; const t = setTimeout(() => setOn(false), 3500); return () => clearTimeout(t); }, [on]);
  return (
    <button className={"danger" + (on ? " dk-armed" : "")} disabled={disabled} title={title}
      onClick={(e) => { e.stopPropagation(); if (on) { setOn(false); onConfirm(); } else setOn(true); }}>
      {on ? (armed ?? "Sure?") : <>{icon && <Icon name={icon} size={13} />}{label && ` ${label}`}</>}
    </button>
  );
}

// `embedded`: shown as a tab in the editor column instead of a popup; `active` tells whether that tab is in front (polling pauses while it is not).
export function DockerPanel({ project, projectName, onClose, onStatus, onOpenDatabase, embedded, active = true }: {
  project: string; projectName: string; onClose: () => void; onStatus: (s: DockerStatus) => void; onOpenDatabase: (container: string) => void; embedded?: boolean; active?: boolean;
}) {
  const call = <T = any,>(path: string, body?: unknown) => api<T>(`/api/docker/${path}`, { body, project });
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [df, setDf] = useState<Df>([]);
  const [hist, setHist] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });
  const [tab, setTab] = useState<Tab>("containers");
  const [selected, setSelected] = useState("");
  const [q, setQ] = useState("");
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pull, setPull] = useState("");
  const running = status?.state === "running";

  const say = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), bad ? 8000 : 4500);
  }, []);

  const loadStatus = useCallback(() => {
    call<DockerStatus>("status").then((s) => { setStatus(s); onStatus(s); }).catch((e) => setStatus({ state: "stopped", error: e.message }));
  }, [project]);
  const loadOverview = useCallback(() => { call<Overview>("overview").then(setOv).catch(() => {}); }, [project]);
  const loadStats = useCallback(() => {
    call<Record<string, Stat>>("stats").then((s) => {
      setStats(s);
      const all = Object.values(s);
      setHist((h) => ({
        cpu: [...h.cpu, all.reduce((a, x) => a + x.cpu, 0)].slice(-40),
        mem: [...h.mem, all.reduce((a, x) => a + toBytes(x.mem.split(" / ")[0]), 0)].slice(-40),
      }));
    }).catch(() => {});
  }, [project]);
  const loadDf = useCallback(() => { call<Df>("df").then(setDf).catch(() => {}); }, [project]);

  usePoll(loadStatus, 4000, active);
  usePoll(loadOverview, 3000, !!running && active);
  usePoll(loadStats, 4000, !!running && active);
  usePoll(loadDf, 30000, !!running && active);
  useEffect(() => { if (!running) { setOv(null); setStats({}); setHist({ cpu: [], mem: [] }); } }, [running]);

  const refresh = () => { loadStatus(); loadOverview(); loadStats(); loadDf(); };
  // Run a Docker action; the item stays "busy" until it finishes, errors show as a toast.
  const act = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy((b) => new Set(b).add(key));
    try { const r = await fn(); if (ok || r?.out) say(r?.out || ok!); }
    catch (e: any) { say(e.message, true); }
    finally { setBusy((b) => { const n = new Set(b); n.delete(key); return n; }); refresh(); }
  };
  const container = (c: Container, action: string) => act(c.id, () => call("container", { action, id: c.id }), undefined);
  const compose = (g: { project: string; dir: string; files: string[] }, action: string) =>
    act("stack:" + g.project, () => call("compose", { action, name: g.project, dir: g.dir, files: g.files }), `${g.project}: ${action} done`);
  const projectCompose = (action: string) => act("stack:root", () => call("compose", { action }), `${projectName}: ${action} done`);

  const sel = ov?.containers.find((c) => c.id === selected);
  useEffect(() => { if (selected && ov && !sel) setSelected(""); }, [ov, sel, selected]);

  // ---- derived data
  const containers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (ov?.containers ?? []).filter((c) =>
      (!onlyRunning || c.state === "running") &&
      (!needle || [c.name, c.image, c.compose?.project ?? "", c.compose?.service ?? "", ...c.ports.map((p) => String(p.host ?? p.container))].join(" ").toLowerCase().includes(needle)));
  }, [ov, q, onlyRunning]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; project: string; dir: string; files: string[]; items: Container[]; mine: boolean }>();
    for (const c of containers) {
      const key = c.compose?.project ?? "";
      if (!map.has(key)) map.set(key, { key, project: key, dir: c.compose?.dir ?? "", files: c.compose?.files ?? [], items: [], mine: !!c.compose && c.compose.dir === ov?.root });
      map.get(key)!.items.push(c);
    }
    return [...map.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(!a.key) - Number(!b.key) || a.key.localeCompare(b.key));
  }, [containers, ov]);

  const dfOf = (type: string) => df.find((d) => d.type.toLowerCase().includes(type));
  const totalCpu = hist.cpu.at(-1) ?? 0;
  const totalMem = hist.mem.at(-1) ?? 0;

  // ---- not available states
  const unavailable = status && status.state !== "running";
  const header = (
    <div className="dk-head">
      <span className="dk-logo"><Icon name="docker" size={20} /></span>
      <div className="dk-title">
        <h3>Docker</h3>
        <small>
          {!status ? "Connecting…" : status.state === "running" ? `Engine ${status.version} · ${status.cpus} CPU · ${fmtBytes(status.memory)} · ${status.context}`
            : status.state === "missing" ? "Not installed" : "Engine not running"}
        </small>
      </div>
      <span style={{ flex: 1 }} />
      {running && <div className="dk-search top"><Icon name="search" size={13} /><input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      <button className="g-icon" style={{ visibility: "visible" }} title="Refresh" onClick={refresh}><Icon name="rotate" size={15} /></button>
      {!embedded && <button className="g-icon" style={{ visibility: "visible" }} title="Close" onClick={onClose}><Icon name="x" size={16} /></button>}
    </div>
  );

  let body: ReactNode;
  if (!status) body = <div className="dk-center"><div className="muted">Checking Docker…</div></div>;
  else if (status.state === "missing") {
    body = (
      <div className="dk-center">
        <span className="dk-bigicon"><Icon name="docker" size={44} /></span>
        <h4>Docker isn't installed</h4>
        <p className="muted">Install Docker Desktop (or OrbStack / Colima) and this panel will show your containers, images, volumes and networks.</p>
        <a className="dk-linkbtn" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer">Get Docker Desktop <Icon name="external" size={13} /></a>
        <button onClick={refresh}>Check again</button>
      </div>
    );
  } else if (status.state === "stopped") {
    body = (
      <div className="dk-center">
        <span className="dk-bigicon off"><Icon name="docker" size={44} /></span>
        <h4>Docker isn't running</h4>
        <p className="muted">The Docker engine isn't answering. Start Docker Desktop and wait for it to finish starting.</p>
        {status.error && <code className="dk-errline">{status.error}</code>}
        <div className="dk-row-btns">
          <button className="primary" onClick={() => act("launch", () => call("launch", {}), "Starting Docker…")}><Icon name="play" size={13} /> Start Docker Desktop</button>
          <button onClick={refresh}>Retry</button>
        </div>
      </div>
    );
  } else {
    const s = status;
    const imgSize = dfOf("image"), volSize = dfOf("volume"), cache = dfOf("cache");
    body = (
      <>
        <div className="dk-tiles">
          <div className="dk-tile">
            <span className="dk-tile-label"><Icon name="box" size={13} /> Containers</span>
            <b className="dk-big"><span className="ok">{s.running}</span><i> / {s.containers}</i></b>
            <small>{s.paused ? `${s.paused} paused · ` : ""}{s.stopped} stopped</small>
          </div>
          <div className="dk-tile">
            <span className="dk-tile-label"><Icon name="gauge" size={13} /> CPU</span>
            <b className="dk-big">{totalCpu.toFixed(1)}<i>%</i></b>
            <Spark data={hist.cpu} tone="cpu" />
          </div>
          <div className="dk-tile">
            <span className="dk-tile-label"><Icon name="gauge" size={13} /> Memory</span>
            <b className="dk-big">{fmtBytes(totalMem)}</b>
            <Spark data={hist.mem} tone="mem" />
          </div>
          <div className="dk-tile">
            <span className="dk-tile-label"><Icon name="layers" size={13} /> Images</span>
            <b className="dk-big">{s.images}</b>
            <small>{imgSize ? `${imgSize.size} · ${imgSize.reclaimable.replace(/\s*\(.*\)/, "")} reclaimable` : "…"}</small>
          </div>
          <div className="dk-tile">
            <span className="dk-tile-label"><Icon name="database" size={13} /> Volumes</span>
            <b className="dk-big">{ov?.volumes.length ?? "…"}</b>
            <small>{volSize ? `${volSize.size}${cache ? ` · cache ${cache.size}` : ""}` : "…"}</small>
          </div>
        </div>

        <div className="dk-tabs">
          {([["containers", "Containers", "box", ov?.containers.length], ["images", "Images", "layers", ov?.images.length], ["volumes", "Volumes", "database", ov?.volumes.length], ["networks", "Networks", "network", ov?.networks.length]] as const).map(([k, label, icon, n]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><Icon name={icon} size={14} /> {label}{n !== undefined && <span className="dk-count">{n}</span>}</button>
          ))}
          <span style={{ flex: 1 }} />
          {tab === "containers" && <label className="dk-check"><input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} /> Running only</label>}
        </div>

        <div className="dk-content">
          {!ov ? <div className="dk-center"><div className="muted">Loading…</div></div> : tab === "containers" ? (
            <div className="dk-split">
              <div className="dk-list">
                {ov.composeFile && !ov.containers.some((c) => c.compose?.dir === ov.root) && (
                  <div className="dk-callout">
                    <Icon name="layers" size={16} />
                    <div><b>{projectName}</b> has a <code>{ov.composeFile}</code> that isn't running.</div>
                    <button className="primary" disabled={busy.has("stack:root")} onClick={() => projectCompose("up")}><Icon name="play" size={13} /> {busy.has("stack:root") ? "Starting…" : "Compose up"}</button>
                  </div>
                )}
                {!groups.length && <div className="dk-empty"><Icon name="box" size={30} /><p>{q || onlyRunning ? "No containers match." : "No containers yet."}</p></div>}
                {groups.map((g) => {
                  const off = collapsed.has(g.key);
                  const up = g.items.filter((c) => c.state === "running").length;
                  const key = "stack:" + g.project;
                  return (
                    <div key={g.key || "_"} className="dk-group">
                      <div className="dk-ghead" onClick={() => setCollapsed((c) => { const n = new Set(c); off ? n.delete(g.key) : n.add(g.key); return n; })}>
                        <Icon name={off ? "chevronRight" : "chevronDown"} size={14} />
                        <b>{g.key || "Standalone"}</b>
                        {g.mine && <span className="dk-pill acc">this project</span>}
                        <span className="dk-gcount">{up}/{g.items.length} running</span>
                        <span style={{ flex: 1 }} />
                        {g.key && (
                          <span className="dk-gactions" onClick={(e) => e.stopPropagation()}>
                            {busy.has(key) ? <span className="dk-spin" /> : <>
                              <button className="dk-mini" onClick={() => compose(g, up ? "restart" : "up")}>{up ? <><Icon name="rotate" size={11} /> Restart</> : <><Icon name="play" size={11} /> Up</>}</button>
                              {up > 0 && <button className="dk-mini" onClick={() => compose(g, "stop")}><Icon name="stop" size={11} /> Stop</button>}
                              <Confirm label="Down" armed="Down & remove?" title="Stop and remove the stack's containers (volumes are kept)" onConfirm={() => compose(g, "down")} />
                            </>}
                          </span>
                        )}
                      </div>
                      {!off && g.items.map((c) => (
                        <ContainerRow key={c.id} c={c} stat={stats[c.id]} selected={c.id === selected} busy={busy.has(c.id)}
                          onSelect={() => setSelected(c.id === selected ? "" : c.id)} onAction={(a) => container(c, a)} onDb={() => onOpenDatabase(c.name)} />
                      ))}
                    </div>
                  );
                })}
              </div>
              {sel && <DockerDetail key={sel.id} c={sel} stat={stats[sel.id]} project={project} busy={busy.has(sel.id)}
                onAction={(a) => container(sel, a)} onClose={() => setSelected("")} />}
            </div>
          ) : tab === "images" ? (
            <div className="dk-table-wrap">
              <div className="dk-toolbar">
                <form className="dk-pull" onSubmit={(e) => { e.preventDefault(); const n = pull.trim(); if (n) act("pull", () => call("image", { action: "pull", name: n }), `Pulled ${n}`).then(() => setPull("")); }}>
                  <input placeholder="Pull an image, e.g. postgres:16" value={pull} onChange={(e) => setPull(e.target.value)} />
                  <button className="primary" disabled={!pull.trim() || busy.has("pull")}><Icon name="download" size={13} /> {busy.has("pull") ? "Pulling…" : "Pull"}</button>
                </form>
                <span style={{ flex: 1 }} />
                <Confirm label="Prune dangling" armed="Remove dangling?" disabled={busy.has("prune")} onConfirm={() => act("prune", () => call("prune", { kind: "images" }), "Pruned")} />
                <Confirm label="Prune unused" armed="Remove all unused?" title="Remove every image not used by a container" disabled={busy.has("prune")} onConfirm={() => act("prune", () => call("prune", { kind: "images-all" }), "Pruned")} />
              </div>
              <table className="dk-table">
                <thead><tr><th>Image</th><th>Tag</th><th>ID</th><th>Size</th><th>Created</th><th>Used by</th><th /></tr></thead>
                <tbody>
                  {ov.images.filter((i) => !q || i.ref.toLowerCase().includes(q.toLowerCase())).map((i) => (
                    <tr key={i.id + i.ref}>
                      <td><b>{i.dangling ? <span className="faint">&lt;none&gt;</span> : i.repository}</b></td>
                      <td>{i.tag === "<none>" ? <span className="faint">—</span> : <span className="dk-pill">{i.tag}</span>}</td>
                      <td className="mono faint">{i.id}</td>
                      <td>{i.size}</td>
                      <td className="faint">{i.created}</td>
                      <td>{i.usedBy.length ? i.usedBy.map((n) => <span key={n} className="dk-pill ok">{n}</span>) : <span className="faint">unused</span>}</td>
                      <td className="act"><Confirm label="" icon="trash" title="Remove image" disabled={busy.has("img" + i.id) || i.usedBy.length > 0}
                        onConfirm={() => act("img" + i.id, () => call("image", { action: "remove", name: i.dangling ? i.id : i.ref }), "Image removed")} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!ov.images.length && <div className="dk-empty"><Icon name="layers" size={30} /><p>No images.</p></div>}
            </div>
          ) : tab === "volumes" ? (
            <div className="dk-table-wrap">
              <div className="dk-toolbar">
                <span className="muted">Volumes hold container data. Removing one deletes that data for good.</span>
                <span style={{ flex: 1 }} />
                <Confirm label="Prune unused" armed="Delete unused data?" disabled={busy.has("prune")} onConfirm={() => act("prune", () => call("prune", { kind: "volumes" }), "Pruned")} />
              </div>
              <table className="dk-table">
                <thead><tr><th>Name</th><th>Driver</th><th>Used by</th><th /></tr></thead>
                <tbody>
                  {ov.volumes.filter((v) => !q || v.name.toLowerCase().includes(q.toLowerCase())).map((v) => (
                    <tr key={v.name}>
                      <td><b className="mono" title={v.name}>{v.name.length > 40 ? v.name.slice(0, 18) + "…" + v.name.slice(-16) : v.name}</b></td>
                      <td className="faint">{v.driver}</td>
                      <td>{v.usedBy.length ? v.usedBy.map((n) => <span key={n} className="dk-pill ok">{n}</span>) : <span className="faint">unused</span>}</td>
                      <td className="act"><Confirm label="" icon="trash" title="Delete volume" disabled={busy.has("vol" + v.name) || v.usedBy.length > 0}
                        onConfirm={() => act("vol" + v.name, () => call("volume", { name: v.name }), "Volume deleted")} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!ov.volumes.length && <div className="dk-empty"><Icon name="database" size={30} /><p>No volumes.</p></div>}
            </div>
          ) : (
            <div className="dk-table-wrap">
              <div className="dk-toolbar">
                <span className="muted">Containers on the same network can reach each other by name.</span>
                <span style={{ flex: 1 }} />
                <Confirm label="Prune unused" armed="Remove unused?" disabled={busy.has("prune")} onConfirm={() => act("prune", () => call("prune", { kind: "networks" }), "Pruned")} />
              </div>
              <table className="dk-table">
                <thead><tr><th>Name</th><th>Driver</th><th>Scope</th><th>Containers</th><th /></tr></thead>
                <tbody>
                  {ov.networks.filter((n) => !q || n.name.toLowerCase().includes(q.toLowerCase())).map((n) => (
                    <tr key={n.id}>
                      <td><b>{n.name}</b> {n.builtin && <span className="dk-pill">built-in</span>}</td>
                      <td className="faint">{n.driver}</td>
                      <td className="faint">{n.scope}</td>
                      <td>{n.usedBy.length ? n.usedBy.map((x) => <span key={x} className="dk-pill ok">{x}</span>) : <span className="faint">none</span>}</td>
                      <td className="act">{!n.builtin && <Confirm label="" icon="trash" title="Remove network" disabled={busy.has("net" + n.id) || n.usedBy.length > 0}
                        onConfirm={() => act("net" + n.id, () => call("network", { name: n.name }), "Network removed")} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className={embedded ? "pg-embed-root" : "modal-backdrop dk-backdrop"} onMouseDown={embedded ? undefined : (e) => e.target === e.currentTarget && onClose()}>
      <div className={embedded ? "pg-embed-panel dk-embedded" : "dk-panel" + (unavailable ? " small" : "")}>
        {header}
        {body}
        {toast && <div className={"dk-toast" + (toast.bad ? " bad" : "")} onClick={() => setToast(null)}>{toast.text}</div>}
      </div>
    </div>
  );
}

// Images the database browser can talk to: PostgreSQL, MySQL / MariaDB and Redis (and their common variants).
const isDbImage = (image: string) => /postgres|postgis|timescale|pgvector|mysql|mariadb|percona|redis|valkey|keydb/i.test(image);

function ContainerRow({ c, stat, selected, busy, onSelect, onAction, onDb }: {
  c: Container; stat?: Stat; selected: boolean; busy: boolean; onSelect: () => void; onAction: (a: string) => void; onDb: () => void;
}) {
  const on = c.state === "running";
  const tone = stateTone(c);
  const published = c.ports.filter((p) => p.host);
  return (
    <div className={"dk-crow" + (selected ? " sel" : "")} onClick={onSelect}>
      <span className={"dk-dot " + tone} title={c.state} />
      <div className="dk-cmain">
        <div className="dk-cname">
          <b title={c.name}>{c.compose?.service || c.name}</b>
          {c.compose?.service && <small className="faint" title={c.name}>{c.name}</small>}
          {c.health && c.state === "running" && <span className={"dk-pill " + (c.health === "healthy" ? "ok" : c.health === "starting" ? "warn" : "bad")}>{c.health}</span>}
        </div>
        <div className="dk-csub">
          <span className="dk-image" title={c.image}>{c.image}</span>
          <span className={"dk-status " + tone}>{c.state === "exited" && c.exitCode ? `${c.status}` : c.status}</span>
        </div>
      </div>
      <div className="dk-cports">
        {published.slice(0, 3).map((p) => (
          <a key={`${p.host}:${p.container}`} className="dk-port pub" href={`http://localhost:${p.host}`} target="_blank" rel="noreferrer"
            title={`localhost:${p.host} → container ${p.container}/${p.proto}`} onClick={(e) => e.stopPropagation()}>:{p.host}</a>
        ))}
        {published.length > 3 && <span className="dk-port">+{published.length - 3}</span>}
      </div>
      <div className="dk-cstat">
        {on && stat ? <>
          <div className="dk-mbar" title={`CPU ${stat.cpu.toFixed(1)}%`}><span>CPU</span><div className="u-track"><div className={"u-fill " + (stat.cpu > 80 ? "hot" : stat.cpu >= 60 ? "warm" : "ok")} style={{ width: Math.min(100, Math.max(2, stat.cpu)) + "%" }} /></div><em>{stat.cpu.toFixed(0)}%</em></div>
          <div className="dk-mbar" title={`Memory ${stat.mem}`}><span>MEM</span><div className="u-track"><div className={"u-fill " + (stat.memPct > 80 ? "hot" : stat.memPct >= 60 ? "warm" : "ok")} style={{ width: Math.min(100, Math.max(2, stat.memPct)) + "%" }} /></div><em>{stat.mem.split(" / ")[0]}</em></div>
        </> : null}
      </div>
      <div className="dk-cactions" onClick={(e) => e.stopPropagation()}>
        {on && isDbImage(c.image) && <button className="g-icon" style={{ visibility: "visible" }} title="Open in the database browser" onClick={onDb}><Icon name="database" size={14} /></button>}
        {busy ? <span className="dk-spin" /> : on
          ? <>
              <button className="g-icon" style={{ visibility: "visible" }} title="Restart" onClick={() => onAction("restart")}><Icon name="rotate" size={14} /></button>
              <button className="g-icon" style={{ visibility: "visible" }} title="Stop" onClick={() => onAction("stop")}><Icon name="stop" size={14} /></button>
            </>
          : <button className="g-icon" style={{ visibility: "visible" }} title="Start" onClick={() => onAction("start")}><Icon name="play" size={14} /></button>}
      </div>
    </div>
  );
}
