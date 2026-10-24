import "./styles.css";
import { applyTheme, getTheme } from "./lib/theme";
applyTheme(getTheme());

// No browser/WebKit right-click menu ("Reload", "Inspect Element"). Our own menus handle their areas; the native
// one is kept only where it is useful: text fields and selected text (Cut / Copy / Paste).
document.addEventListener("contextmenu", (e) => {
  if (e.defaultPrevented) return;
  const editable = (e.target as HTMLElement).closest?.("input, textarea, [contenteditable=true], .cm-content");
  if (!editable && !window.getSelection()?.toString()) e.preventDefault();
});
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, connect } from "./lib/api";
import { FileTree, type ProjectInfo } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { projectTint } from "./lib/projectColor";
import { GitPanel } from "./components/GitPanel";
import { ChatPanel } from "./components/ChatPanel";
import { TerminalView } from "./components/Terminal";
import { Icon } from "./components/Icon";
import { AddFolderMenu } from "./components/AddFolderMenu";
import { SettingsModal } from "./components/SettingsModal";
import { WelcomeModal } from "./components/WelcomeModal";
import type { RemoteState } from "./components/RemotePanel";
import { ContextMenu, tabMenu } from "./components/ContextMenu";
import { Resizer } from "./components/Resizer";
import { QuickOpen } from "./components/QuickOpen";
import type { Account } from "./components/AccountMenu";
import { TunnelModal, type TunnelInfo } from "./components/TunnelModal";
import { DockerPanel, type DockerStatus } from "./components/DockerPanel";
import { DatabasePanel } from "./components/DatabasePanel";
import { UsagePanel } from "./components/UsagePanel";

type Tab = { key: string; project: string; path: string; content: string; dirty: boolean; kind?: "db" | "term" | "docker" | "usage"; title?: string; command?: string; preset?: { container: string; n: number } }; // kind "pg" / "term": database browser, Docker dashboard or a terminal, shown as a tab in the editor column instead of a file
const tabKey = (project: string, path: string) => `${project}:${path}`;

function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeId, setActiveId] = useState(() => { try { return localStorage.getItem("vibecode.project") ?? ""; } catch { return ""; } });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [side, setSide] = useState<"files" | "git">("files");
  const [status, setStatus] = useState<Record<string, "busy" | "waiting">>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [tunnelFor, setTunnelFor] = useState("");
  useEffect(() => { api<{ tunnels: TunnelInfo[] }>("/api/tunnel/status").then((s) => setTunnels(s.tunnels)).catch(() => {}); }, []);
  const dockerActive = tabs.find((t) => t.key === active)?.kind === "docker"; // the Docker tab does its own faster polling while in front
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  // The status-bar badge: how many containers run. Checked quietly; the dashboard itself polls faster while open.
  useEffect(() => {
    if (dockerActive) return;
    let alive = true;
    const load = () => { if (!document.hidden) api<DockerStatus>("/api/docker/status").then((s) => alive && setDocker(s)).catch(() => {}); };
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [dockerActive]);
  const [ctx, setCtx] = useState<{ x: number; y: number; index: number } | null>(null);
  // Column widths (draggable); the file column takes whatever is left.
  const [w, setW] = useState<{ side: number; term: number; chat: number }>(() => {
    try { return { side: 264, term: 430, chat: 430, ...JSON.parse(localStorage.getItem("vibecode.widths") ?? "{}") }; }
    catch { return { side: 264, term: 430, chat: 430 }; }
  });
  const base = useRef(0);
  const [vw, setVw] = useState(window.innerWidth);
  useEffect(() => { const h = () => setVw(window.innerWidth); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  useEffect(() => { try { localStorage.setItem("vibecode.widths", JSON.stringify(w)); } catch {} }, [w]);
  const [remote, setRemote] = useState<Record<string, RemoteState>>({});
  useEffect(() => { api<RemoteState[]>("/api/remote").then((l) => setRemote(Object.fromEntries(l.map((r) => [r.project, r])))).catch(() => {}); }, []);
  const refreshAccounts = useCallback(() => { api<Account[]>("/api/accounts").then(setAccounts).catch(() => {}); }, []);
  useEffect(() => { refreshAccounts(); }, []);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active); activeRef.current = active;
  const activeIdRef = useRef(activeId); activeIdRef.current = activeId;
  const projectsRef = useRef(projects); projectsRef.current = projects;

  // Keyboard shortcuts: Ctrl+` terminal, ⌘P / Ctrl+P quick open (captured so the browser never prints).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") { e.preventDefault(); toggleTerminalRef.current(); }
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") { e.preventDefault(); e.stopPropagation(); setQuickOpen((o) => !o); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  const loadProjects = useCallback(async () => {
    const list = await api<ProjectInfo[]>("/api/projects");
    setProjects(list);
    setProjectsLoaded(true);
    // Keep focus on a project that still exists; otherwise fall back to the first one.
    setActiveId((cur) => (list.some((p) => p.id === cur) ? cur : list[0]?.id ?? ""));
    // Drop tabs of folders that were closed.
    setTabs((ts) => ts.filter((t) => list.some((p) => p.id === t.project)));
  }, []);
  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { try { localStorage.setItem("vibecode.project", activeId); } catch {} }, [activeId]);

  // Disk changes (agent edits, git, external): refresh that project's tree/git and reload clean tabs.
  useEffect(() => {
    const conn = connect((m) => {
      if (m.type === "projects-changed") loadProjects();
      else if (m.type === "tunnel")
        setTunnels((l) => {
          const rest = l.filter((t) => !(t.project === m.project && t.port === m.port));
          return m.state === "stopped" ? rest : [...rest, { project: m.project, port: m.port, state: m.state, url: m.url, error: m.error }];
        });
      else if (m.type === "remote-status") setRemote((r) => ({ ...r, [m.project]: m }));
      else if (m.type === "fs-changed") {
        setVersions((v) => ({ ...v, [m.project]: (v[m.project] ?? 0) + 1 }));
        for (const t of tabsRef.current) {
          if (t.kind || t.project !== m.project || t.dirty) continue;
          api<{ content: string }>(`/api/file?path=${encodeURIComponent(t.path)}`, { project: t.project })
            .then(({ content }) => setTabs((cur) => cur.map((c) => (c.key === t.key && !c.dirty && c.content !== content ? { ...c, content } : c))))
            .catch(() => {});
        }
      }
    });
    return () => { conn.close(); };
  }, [loadProjects]);

  const project = projects.find((p) => p.id === activeId);

  const removeFolder = (id: string) => api(`/api/projects/${id}`, { method: "DELETE" }).catch((e) => alert(e.message));

  const open = useCallback(async (projectId: string, path: string) => {
    const { content } = await api<{ content: string }>(`/api/file?path=${encodeURIComponent(path)}`, { project: projectId }).catch(() => ({ content: "" }));
    const key = tabKey(projectId, path);
    setTabs((t) => (t.some((x) => x.key === key) ? t : [...t, { key, project: projectId, path, content, dirty: false }]));
    setActive(key);
    setActiveId(projectId); // opening a file focuses its project
  }, []);

  // `container`: a database container to connect to (from the Docker panel); without it the tab just opens on the connection list.
  const openDatabase = (projectId: string, container?: string) => {
    const key = `db:${projectId}`;
    const preset = container ? { container, n: Date.now() } : undefined;
    setTabs((t) => (t.some((x) => x.key === key) ? (preset ? t.map((x) => (x.key === key ? { ...x, preset } : x)) : t) : [...t, { key, project: projectId, path: "", content: "", dirty: false, kind: "db", preset }]));
    setActive(key);
    setActiveId(projectId);
  };
  // Terminals are tabs of the editor column too. A new one starts in the focused project's folder; a template run opens one that executes its command.
  const newTerminal = useCallback((title?: string, command?: string) => {
    const id = crypto.randomUUID().slice(0, 8), pid = activeIdRef.current;
    const name = title ?? projectsRef.current.find((p) => p.id === pid)?.name ?? "Terminal";
    setTabs((t) => [...t, { key: `term:${id}`, project: pid, path: "", content: "", dirty: false, kind: "term", title: name, command }]);
    setActive(`term:${id}`);
  }, []);
  const runInTerminal = useCallback((title: string, command: string) => newTerminal(title, command), [newTerminal]);
  // Ctrl+` / the Terminal button: jump to a terminal (opening one if there is none); from a terminal, jump back to the last file.
  const toggleTerminal = () => {
    const cur = tabsRef.current.find((t) => t.key === activeRef.current);
    if (cur?.kind === "term") {
      const back = tabsRef.current.filter((t) => t.kind !== "term").at(-1);
      if (back) setActive(back.key);
      return;
    }
    const terms = tabsRef.current.filter((t) => t.kind === "term");
    const mine = terms.filter((t) => t.project === activeIdRef.current).at(-1) ?? terms.at(-1);
    if (mine) setActive(mine.key); else newTerminal();
  };
  const toggleTerminalRef = useRef(toggleTerminal); toggleTerminalRef.current = toggleTerminal;
  const openDocker = (projectId: string) => {
    const key = `docker:${projectId}`;
    setTabs((t) => (t.some((x) => x.key === key) ? t : [...t, { key, project: projectId, path: "", content: "", dirty: false, kind: "docker" }]));
    setActive(key);
    setActiveId(projectId);
  };
  // Token usage across all projects: one tab for the whole app.
  const openUsage = () => {
    setTabs((t) => (t.some((x) => x.key === "usage") ? t : [...t, { key: "usage", project: activeIdRef.current, path: "", content: "", dirty: false, kind: "usage" }]));
    setActive("usage");
  };
  const tab = tabs.find((t) => t.key === active);
  const save = () => tab && !tab.kind && api("/api/file?path=" + encodeURIComponent(tab.path), { method: "PUT", body: { content: tab.content }, project: tab.project })
    .then(() => setTabs((ts) => ts.map((t) => (t.key === tab.key ? { ...t, dirty: false } : t))));
  const closeTabs = (keys: string[]) => {
    const rest = tabs.filter((t) => !keys.includes(t.key));
    setTabs(rest);
    if (keys.includes(active)) setActive(rest.at(-1)?.key ?? "");
  };
  const close = (key: string) => closeTabs([key]);
  // Files moved or deleted from the explorer: keep editor tabs in step.
  const under = (path: string, base: string) => path === base || path.startsWith(base + "/");
  const renameTabs = (project: string, from: string, to: string) => {
    setTabs((ts) => ts.map((t) => {
      if (t.project !== project || !under(t.path, from)) return t;
      const path = to + t.path.slice(from.length);
      return { ...t, path, key: tabKey(project, path) };
    }));
    setActive((a) => (a.startsWith(project + ":") && under(a.slice(project.length + 1), from) ? tabKey(project, to + a.slice(project.length + 1 + from.length)) : a));
  };
  const deleteTabs = (project: string, path: string) => closeTabs(tabsRef.current.filter((t) => t.project === project && under(t.path, path)).map((t) => t.key));
  const nameOf = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);

  // Default is two columns (explorer | chat); an open file and the terminal slot in between, left to right.
  const panes = tabs.length ? 1 : 0;
  // Saved widths can be too wide for the window: shrink terminal, then chat, then explorer so the file column keeps 240px.
  const eff = (() => {
    const e = { ...w };
    const need = () => e.side + (panes ? e.chat : 0) + (tabs.length ? 240 : 0);
    for (const [key, min] of [["chat", 300], ["side", 200]] as const) {
      const over = need() - vw;
      if (over > 0) e[key] = Math.max(min, e[key] - over);
    }
    return e;
  })();
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const room = (others: number) => window.innerWidth - others - 240; // keep at least 240px for the file column
  const grow = (key: "side" | "chat", dir: 1 | -1, min: number) => (dx: number) =>
    setW((cur) => {
      const others = (key !== "side" ? eff.side : 0) + (key !== "chat" && panes ? eff.chat : 0);
      return { ...cur, [key]: clamp(base.current + dir * dx, min, Math.max(min, room(others))) };
    });
  return (
    <div className={"app" + (panes ? "" : " solo")}>
      <aside className="side" style={{ width: eff.side }}>
        <div className="sidebar-tabs">
          <button className={side === "files" ? "on" : ""} onClick={() => setSide("files")}><Icon name="folder" size={14} /> Files</button>
          <button className={side === "git" ? "on" : ""} onClick={() => setSide("git")}><Icon name="branch" size={14} /> Git</button>
        </div>
        <div className="folder">
          <span className="muted root">{side === "files" ? "Projects" : "Source control"}</span>
          <span className="folder-actions">
            <button className="g-icon" style={{ visibility: "visible" }} title="Search files (⌘P)" onClick={() => setQuickOpen(true)}><Icon name="search" size={15} /></button>
            <AddFolderMenu onAdded={setActiveId} />
          </span>
        </div>
        {side === "files"
          ? <FileTree projects={projects} activeId={activeId} versions={versions} status={status} remote={remote} tunnels={tunnels} onTunnel={setTunnelFor}
              onActivate={setActiveId} onRemove={removeFolder} onOpen={open}
              onChanged={(id) => setVersions((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }))} onRenamed={renameTabs} onDeleted={deleteTabs} />
          : project && <GitPanel key={project.id} project={project.id} projectName={project.name} version={versions[project.id] ?? 0} onOpen={(p) => open(project.id, p)} />}
        <div className="statusbar">
          <button className={tab?.kind === "term" ? "on" : ""} onClick={toggleTerminal} title="Terminal (Ctrl+`)" aria-label="Terminal"><Icon name="terminal" size={15} /></button>
          <button className={dockerActive ? "on" : ""} disabled={!project} onClick={() => project && openDocker(project.id)} title="Docker" aria-label="Docker">
            <Icon name="docker" size={15} />
            {docker?.state === "running" && <span className={"dk-badge" + (docker.running ? "" : " off")}>{docker.running}</span>}
          </button>
          <button className={tab?.kind === "db" ? "on" : ""} disabled={!project} onClick={() => project && openDatabase(project.id)} title="Databases: PostgreSQL, MySQL, Redis" aria-label="Database"><Icon name="database" size={15} /></button>
          <button className={tab?.kind === "usage" ? "on" : ""} onClick={openUsage} title="Token usage" aria-label="Token usage"><Icon name="chart" size={15} /></button>
        </div>
      </aside>
      <Resizer onStart={() => (base.current = eff.side)} onDrag={grow("side", 1, 200)} />
      {tab && (
        <main className="main">
          <div className="tabs">
            {tabs.map((t, i) => (
              <div key={t.key} className={"tab" + (t.key === active ? " on" : "")} title={t.kind === "db" ? `Database · ${nameOf[t.project] ?? ""}` : t.kind === "docker" ? `Docker` : t.kind === "usage" ? "Token usage"  : t.kind === "term" ? `Terminal in ${nameOf[t.project] ?? ""}` : `${nameOf[t.project] ?? ""}/${t.path}`}
                onClick={() => { setActive(t.key); setActiveId(t.project); }}
                onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, index: i }); }}>
                {t.kind === "db" ? <><Icon name="database" size={13} /> Database</> : t.kind === "usage" ? <><Icon name="chart" size={13} /> Usage</> : t.kind === "docker" ? <><Icon name="docker" size={13} /> Docker</> : t.kind === "term" ? <><Icon name="terminal" size={13} /> {t.title}</> : t.path.split("/").pop()}{t.dirty ? " ●" : ""}
                {projects.length > 1 && <span className="tab-proj" style={projectTint(projects, t.project)}>{nameOf[t.project]}</span>}
                <span className="x" onClick={(e) => { e.stopPropagation(); close(t.key); }}><Icon name="x" size={13} /></span>
              </div>
            ))}
            <button className="g-icon tab-new" style={{ visibility: "visible" }} title="New terminal" onClick={() => newTerminal()}><Icon name="plus" size={14} /></button>
          </div>
          {/* Database and Docker tabs stay mounted (hidden) while another tab is active, so open connections and queries survive */}
          {tabs.filter((t) => t.kind === "db" && projects.some((p) => p.id === t.project)).map((t) => (
            <div key={t.key} className="pg-embed" hidden={t.key !== active}>
              <DatabasePanel embedded preset={t.preset} project={projects.find((p) => p.id === t.project)!} onClose={() => close(t.key)} />
            </div>
          ))}
          {/* terminals stay mounted too: their shells keep running behind other tabs */}
          {tabs.some((t) => t.kind === "usage") && <div className="pg-embed" hidden={active !== "usage"}><UsagePanel projects={projects} active={active === "usage"} /></div>}
          {tabs.filter((t) => t.kind === "docker" && projects.some((p) => p.id === t.project)).map((t) => (
            <div key={t.key} className="pg-embed" hidden={t.key !== active}>
              <DockerPanel embedded active={t.key === active} project={t.project} projectName={nameOf[t.project] ?? ""} onClose={() => close(t.key)} onStatus={setDocker}
                onOpenDatabase={(c) => openDatabase(t.project, c)} />
            </div>
          ))}
          <div className="term-body term-embed" style={{ display: tab.kind === "term" ? "block" : "none" }}>
            {tabs.filter((t) => t.kind === "term").map((t) => (
              <TerminalView key={t.key} id={t.key.slice(5)} project={t.project} active={t.key === active} command={t.command} onExit={() => close(t.key)} />
            ))}
          </div>
          {!tab.kind && (
            <Editor
              key={tab.key} path={tab.path} content={tab.content} onSave={save}
              onChange={(v) => setTabs((ts) => ts.map((t) => (t.key === tab.key ? { ...t, dirty: true, content: v } : t)))}
            />
          )}
        </main>
      )}
      {panes > 0 && <Resizer onStart={() => (base.current = eff.chat)} onDrag={grow("chat", -1, 300)} />}
      <ChatPanel projects={projects} projectId={activeId} onFocusProject={setActiveId} onStatus={setStatus}
        accounts={accounts} refreshAccounts={refreshAccounts} openSettings={() => setSettingsOpen(true)} onRunInTerminal={runInTerminal}
        project={project} remote={project ? remote[project.id] : undefined} width={panes ? eff.chat : undefined} />
      {quickOpen && project && (
        <QuickOpen project={project}
          recent={tabs.filter((t) => !t.kind && t.project === project.id).map((t) => t.path).reverse()}
          onOpen={(path) => open(project.id, path)} onClose={() => setQuickOpen(false)} />
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={tabMenu(tabs.map((t) => t.key), ctx.index, closeTabs)} />}
      {tunnelFor && projects.find((p) => p.id === tunnelFor) && <TunnelModal project={projects.find((p) => p.id === tunnelFor)!} tunnels={tunnels} onClose={() => setTunnelFor("")} />}
      {projectsLoaded && projects.length === 0 && !settingsOpen && (
        <WelcomeModal accounts={accounts} onAdded={setActiveId} onSignIn={() => setSettingsOpen(true)} />
      )}
      {settingsOpen && <SettingsModal accounts={accounts} refresh={refreshAccounts} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
