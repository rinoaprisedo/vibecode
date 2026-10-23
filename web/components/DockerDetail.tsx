import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, connect, send } from "../lib/api";
import { Icon } from "./Icon";
import { TerminalView } from "./Terminal";

export type Port = { host?: number; container: number; proto: string };
export type Container = {
  id: string; name: string; image: string; state: string; status: string; health: string | null; exitCode: number | null;
  ports: Port[]; created: string; runningFor: string; mounts: string[]; networks: string[]; command: string;
  compose: { project: string; service: string; dir: string; files: string[] } | null;
};
export type Stat = { cpu: number; memPct: number; mem: string; net: string; block: string; pids: number };

type Inspect = {
  image: string; imageId: string; platform: string; created: string; startedAt: string; finishedAt: string; exitCode: number; oomKilled: boolean;
  error: string; restartCount: number; restartPolicy: string; cmd: string; workdir: string; user: string; env: string[];
  mounts: { type: string; source: string; destination: string; rw: boolean; name?: string }[];
  networks: { name: string; ip: string; gateway: string; mac: string; aliases: string[] }[];
  health: { status: string; streak: number; log: { exit: number; out: string; end: string }[] } | null;
  limits: { memory: number; cpus: number }; privileged: boolean; labels: Record<string, string>;
};

export const stateTone = (c: Pick<Container, "state" | "health">) =>
  c.health === "unhealthy" ? "bad" : c.state === "running" ? (c.health === "starting" ? "warn" : "ok")
    : c.state === "paused" || c.state === "restarting" ? "warn" : c.state === "dead" ? "bad" : "off";

const when = (iso: string) => {
  const t = Date.parse(iso);
  return !t || t < 0 || iso.startsWith("0001") ? "—" : new Date(t).toLocaleString();
};
const bytes = (n: number) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : n >= 2 ** 20 ? `${Math.round(n / 2 ** 20)} MB` : `${Math.round(n / 1024)} KB`);

// ---------------------------------------------------------------- Logs

type Line = { ts: string; text: string; cls: string };
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const TS = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s?/;
const classify = (s: string) =>
  /\b(error|fatal|panic|exception|traceback|failed|critical)\b/i.test(s) ? "err" : /\bwarn(ing)?\b/i.test(s) ? "warn" : /\b(debug|trace)\b/i.test(s) ? "dim" : "";

function toLine(raw: string): Line {
  const clean = raw.replace(ANSI, "").replace(/\r$/, "");
  const m = clean.match(TS);
  const text = m ? clean.slice(m[0].length) : clean;
  const d = m ? new Date(m[1]) : null;
  const ts = d && !isNaN(+d) ? d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0") : "";
  return { ts, text, cls: classify(text) };
}

function Logs({ container, state }: { container: string; state: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [ended, setEnded] = useState(false);
  const [q, setQ] = useState("");
  const [showTs, setShowTs] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const buf = useRef<Line[]>([]);
  const rest = useRef("");
  const timer = useRef<number>(0);

  useEffect(() => {
    const id = "dl" + Math.random().toString(36).slice(2);
    buf.current = []; rest.current = ""; setLines([]); setEnded(false);
    const flush = () => { timer.current = 0; setLines(buf.current.slice()); };
    const conn = connect((m) => {
      if (m.id !== id) return;
      if (m.type === "docker-log") {
        const parts = (rest.current + m.data).split("\n");
        rest.current = parts.pop() ?? "";
        for (const p of parts) buf.current.push(toLine(p));
        if (buf.current.length > 4000) buf.current.splice(0, buf.current.length - 4000);
        if (!timer.current) timer.current = window.setTimeout(flush, 80);
      } else if (m.type === "docker-log-end") {
        if (rest.current) { buf.current.push(toLine(rest.current)); rest.current = ""; flush(); }
        setEnded(true);
      }
    });
    send({ type: "docker-logs-open", id, container, tail: 300 });
    return () => { send({ type: "docker-logs-close", id }); conn.close(); if (timer.current) clearTimeout(timer.current); timer.current = 0; };
  }, [container, state]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? lines.filter((l) => l.text.toLowerCase().includes(needle)) : lines;
  }, [lines, q]);

  useLayoutEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown, follow]);
  const onScroll = () => {
    const el = box.current!;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow((f) => (f === atEnd ? f : atEnd));
  };
  const copy = () => navigator.clipboard?.writeText(shown.map((l) => (showTs && l.ts ? l.ts + " " : "") + l.text).join("\n")).catch(() => {});

  return (
    <div className="dk-logs">
      <div className="dk-logbar">
        <div className="dk-search">
          <Icon name="search" size={13} />
          <input placeholder="Filter logs" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="g-icon" style={{ visibility: "visible" }} onClick={() => setQ("")}><Icon name="x" size={12} /></button>}
        </div>
        <label className="dk-check"><input type="checkbox" checked={showTs} onChange={(e) => setShowTs(e.target.checked)} /> Time</label>
        <label className="dk-check"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap</label>
        <button className="dk-mini" onClick={() => { buf.current = []; setLines([]); }} title="Clear the view">Clear</button>
        <button className="dk-mini" onClick={copy} title="Copy shown lines"><Icon name="copy" size={12} /> Copy</button>
      </div>
      <div className={"dk-logbody" + (wrap ? " wrap" : "")} ref={box} onScroll={onScroll}>
        {shown.map((l, i) => (
          <div key={i} className={"dk-line " + l.cls}>
            {showTs && l.ts && <span className="dk-ts">{l.ts}</span>}
            <span className="dk-txt">{l.text || " "}</span>
          </div>
        ))}
        {!shown.length && <div className="dk-empty-note">{q ? "No lines match the filter." : ended ? "No output." : "Waiting for output…"}</div>}
        {ended && shown.length > 0 && <div className="dk-endnote">— stream ended ({state === "running" ? "reconnecting soon" : `container ${state}`}) —</div>}
      </div>
      {!follow && <button className="dk-jump primary" onClick={() => setFollow(true)}>Jump to latest</button>}
    </div>
  );
}

// ---------------------------------------------------------------- Info

const SECRET = /pass|secret|token|key|pwd|credential|auth/i;

function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="dk-kv"><span>{k}</span><b>{children}</b></div>;
}

function Info({ c }: { c: Container }) {
  const [info, setInfo] = useState<Inspect | null>(null);
  const [err, setErr] = useState("");
  const [shown, setShown] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    setErr("");
    api<Inspect>(`/api/docker/inspect?id=${encodeURIComponent(c.id)}`).then((i) => alive && setInfo(i)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [c.id, c.state]);
  if (err) return <div className="err">{err}</div>;
  if (!info) return <div className="muted">Loading…</div>;
  const reveal = (k: string) => setShown((s) => new Set(s).add(k));

  return (
    <div className="dk-info">
      <section>
        <h5>Overview</h5>
        <Row k="Image">{info.image} <small>{info.imageId}</small></Row>
        <Row k="Command"><code>{info.cmd || "—"}</code></Row>
        <Row k="Created">{when(info.created)}</Row>
        <Row k="Started">{when(info.startedAt)}</Row>
        {c.state !== "running" && <Row k="Finished">{when(info.finishedAt)}</Row>}
        <Row k="Exit code">{c.state === "running" ? "—" : <span className={info.exitCode ? "dk-bad" : ""}>{info.exitCode}{info.oomKilled ? " · out of memory" : ""}</span>}</Row>
        {info.error && <Row k="Error"><span className="dk-bad">{info.error}</span></Row>}
        <Row k="Restart policy">{info.restartPolicy}{info.restartCount ? ` · restarted ${info.restartCount}×` : ""}</Row>
        {info.workdir && <Row k="Working dir"><code>{info.workdir}</code></Row>}
        {info.user && <Row k="User">{info.user}</Row>}
        {info.platform && <Row k="Platform">{info.platform}</Row>}
        {(info.limits.memory > 0 || info.limits.cpus > 0) && <Row k="Limits">{info.limits.cpus ? `${info.limits.cpus} CPU` : ""} {info.limits.memory ? bytes(info.limits.memory) : ""}</Row>}
        {info.privileged && <Row k="Privileged"><span className="dk-bad">yes</span></Row>}
      </section>

      {info.health && (
        <section>
          <h5>Health <span className={"dk-pill " + (info.health.status === "healthy" ? "ok" : info.health.status === "starting" ? "warn" : "bad")}>{info.health.status}</span></h5>
          {info.health.log.map((l, i) => (
            <div key={i} className={"dk-hlog" + (l.exit ? " bad" : "")}><span>exit {l.exit}</span><code>{l.out || "(no output)"}</code></div>
          ))}
        </section>
      )}

      {c.ports.length > 0 && (
        <section>
          <h5>Ports</h5>
          <div className="dk-ports">
            {c.ports.map((p) => p.host
              ? <a key={`${p.host}:${p.container}`} className="dk-port pub" href={`http://localhost:${p.host}`} target="_blank" rel="noreferrer" title="Open in browser">localhost:{p.host} → {p.container}/{p.proto} <Icon name="external" size={11} /></a>
              : <span key={`${p.container}/${p.proto}`} className="dk-port" title="Exposed inside Docker only">{p.container}/{p.proto}</span>)}
          </div>
        </section>
      )}

      {info.networks.length > 0 && (
        <section>
          <h5>Networks</h5>
          {info.networks.map((n) => (
            <div key={n.name} className="dk-table-row"><b>{n.name}</b><span>{n.ip || "—"}</span><span className="faint">gw {n.gateway || "—"}</span></div>
          ))}
        </section>
      )}

      {info.mounts.length > 0 && (
        <section>
          <h5>Mounts</h5>
          {info.mounts.map((m) => (
            <div key={m.destination} className="dk-mount">
              <span className={"dk-pill " + (m.type === "bind" ? "info" : "")}>{m.type}{m.rw ? "" : " · ro"}</span>
              <code title={m.source}>{m.name ?? m.source}</code>
              <Icon name="chevronRight" size={12} />
              <code>{m.destination}</code>
            </div>
          ))}
        </section>
      )}

      {info.env.length > 0 && (
        <section>
          <h5>Environment <small>{info.env.length}</small></h5>
          {info.env.map((e) => {
            const i = e.indexOf("=");
            const k = e.slice(0, i), v = e.slice(i + 1);
            const hide = SECRET.test(k) && !shown.has(k);
            return (
              <div key={k} className="dk-env">
                <span>{k}</span>
                {hide ? <button className="dk-mini" onClick={() => reveal(k)}>•••••• show</button> : <code>{v || "(empty)"}</code>}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Detail pane

function Meter({ label, pct, text }: { label: string; pct: number; text: string }) {
  const lv = pct > 80 ? " hot" : pct >= 60 ? " warm" : " ok";
  return (
    <div className="dk-meter">
      <div className="dk-meter-top"><span>{label}</span><b className={lv.trim()}>{text}</b></div>
      <div className="u-track"><div className={"u-fill" + lv} style={{ width: Math.min(100, Math.max(1, pct)) + "%" }} /></div>
    </div>
  );
}

export function DockerDetail({ c, stat, project, busy, onAction, onClose }: {
  c: Container; stat?: Stat; project: string; busy: boolean;
  onAction: (action: string) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"logs" | "info" | "shell">("logs");
  const running = c.state === "running";
  const [removing, setRemoving] = useState(false);
  useEffect(() => { setRemoving(false); }, [c.id]);
  useEffect(() => { if (tab === "shell" && !running) setTab("logs"); }, [running, tab]);
  const tone = stateTone(c);

  return (
    <div className="dk-detail">
      <div className="dk-dhead">
        <span className={"dk-dot " + tone} />
        <div className="dk-dtitle">
          <b title={c.name}>{c.name}</b>
          <small title={c.image}>{c.image}</small>
        </div>
        <div className="dk-dactions">
          {running
            ? <>
                <button disabled={busy} onClick={() => onAction("restart")} title="Restart"><Icon name="rotate" size={13} /> Restart</button>
                <button disabled={busy} onClick={() => onAction("stop")} title="Stop"><Icon name="stop" size={13} /> Stop</button>
              </>
            : <button disabled={busy} className="primary" onClick={() => onAction("start")}><Icon name="play" size={13} /> Start</button>}
          {removing
            ? <button className="danger dk-armed" disabled={busy} onClick={() => onAction("remove")} onBlur={() => setRemoving(false)} autoFocus>Delete?</button>
            : <button className="danger" disabled={busy} title="Remove container" onClick={() => setRemoving(true)}><Icon name="trash" size={13} /></button>}
          <button className="g-icon" style={{ visibility: "visible" }} title="Close details" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
      </div>

      <div className="dk-dmeta">
        <span className={"dk-pill " + tone}>{c.health && c.state === "running" ? `${c.state} · ${c.health}` : c.state}</span>
        <span>{c.status}</span>
        <span className="faint">{c.id}</span>
      </div>

      {running && stat && (
        <div className="dk-meters">
          <Meter label="CPU" pct={stat.cpu} text={`${stat.cpu.toFixed(1)}%`} />
          <Meter label="Memory" pct={stat.memPct} text={stat.mem.split(" / ")[0]} />
          <div className="dk-meter plain"><span>Network I/O</span><b>{stat.net}</b></div>
          <div className="dk-meter plain"><span>Disk I/O</span><b>{stat.block}</b></div>
          <div className="dk-meter plain"><span>Processes</span><b>{stat.pids}</b></div>
        </div>
      )}

      <div className="dk-subtabs">
        <button className={tab === "logs" ? "on" : ""} onClick={() => setTab("logs")}>Logs</button>
        <button className={tab === "info" ? "on" : ""} onClick={() => setTab("info")}>Details</button>
        <button className={tab === "shell" ? "on" : ""} disabled={!running} onClick={() => setTab("shell")} title={running ? "Open a shell inside the container" : "Container is not running"}>Shell</button>
      </div>
      <div className="dk-dbody">
        {tab === "logs" && <Logs container={c.name} state={c.state} />}
        {tab === "info" && <Info c={c} />}
        {tab === "shell" && running && <div className="dk-shell"><TerminalView key={c.id} id={`dk-${c.id}`} project={project} docker={c.name} active onExit={() => setTab("logs")} /></div>}
      </div>
    </div>
  );
}
