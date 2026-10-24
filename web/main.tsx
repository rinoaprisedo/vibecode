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
import { TerminalPanel, type TermRun } from "./components/TerminalPanel";
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
import { PostgresPanel } from "./components/PostgresPanel";

type Tab = { key: string; project: string; path: string; content: string; dirty: boolean };
const tabKey = (project: string, path: string) => `${project}:${path}`;

function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeId, setActiveId] = useState(() => { try { return localStorage.getItem("vibecode.project") ?? ""; } catch { return ""; } });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [side, setSide] = useState<"files" | "git">("files");
  const [termOpen, setTermOpen] = useState(false);
  const [termRun, setTermRun] = useState<TermRun | undefined>();
  useEffect(() => { if (!termOpen) setTermRun(undefined); }, [termOpen]); // a stale run must not re-execute when the panel is reopened
  const runInTerminal = useCallback((title: string, command: string) => { setTermRun((r) => ({ seq: (r?.seq ?? 0) + 1, title, command })); setTermOpen(true); }, []);
  const [status, setStatus] = useState<Record<string, "busy" | "waiting">>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [tunnelFor, setTunnelFor] = useState("");
  useEffect(() => { api<{ tunnels: TunnelInfo[] }>("/api/tunnel/status").then((s) => setTunnels(s.tunnels)).catch(() => {}); }, []);
  const [dockerOpen, setDockerOpen] = useState(false);
  const [pgFor, setPgFor] = useState("");
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  // The status-bar badge: how many containers run. Checked quietly; the dashboard itself polls faster while open.
  useEffect(() => {
    if (dockerOpen) return;
    let alive = true;
    const load = () => { if (!document.hidden) api<DockerStatus>("/api/docker/status").then((s) => alive && setDocker(s)).catch(() => {}); };
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [dockerOpen]);
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

  // Keyboard shortcuts: Ctrl+` terminal, ⌘P / Ctrl+P quick open (captured so the browser never prints).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") { e.preventDefault(); setTermOpen((o) => !o); }
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
          if (t.project !== m.project || t.dirty) continue;
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

  const tab = tabs.find((t) => t.key === active);
  const save = () => tab && api("/api/file?path=" + encodeURIComponent(tab.path), { method: "PUT", body: { content: tab.content }, project: tab.project })
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
  const panes = (tabs.length ? 1 : 0) + (termOpen ? 1 : 0);
  // Saved widths can be too wide for the window: shrink terminal, then chat, then explorer so the file column keeps 240px.
  const eff = (() => {
    const e = { ...w };
    const termFixed = tabs.length > 0 && termOpen;
    const need = () => e.side + (panes ? e.chat : 0) + (termFixed ? e.term : 0) + (tabs.length ? 240 : termOpen ? 260 : 0);
    for (const [key, min] of [["term", 260], ["chat", 300], ["side", 200]] as const) {
      const over = need() - vw;
      if (over > 0) e[key] = Math.max(min, e[key] - over);
    }
    return e;
  })();
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const room = (others: number) => window.innerWidth - others - 240; // keep at least 240px for the file column
  const grow = (key: "side" | "term" | "chat", dir: 1 | -1, min: number) => (dx: number) =>
    setW((cur) => {
      const others = (key !== "side" ? eff.side : 0) + (key !== "chat" && panes ? eff.chat : 0) + (key !== "term" && tabs.length && termOpen ? eff.term : 0);
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
          ? <FileTree projects={projects} activeId={activeId} versions={versions} status={status} remote={remote} tunnels={tunnels} onTunnel={setTunnelFor} onPostgres={setPgFor}
              onActivate={setActiveId} onRemove={removeFolder} onOpen={open}
              onChanged={(id) => setVersions((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }))} onRenamed={renameTabs} onDeleted={deleteTabs} />
          : project && <GitPanel key={project.id} project={project.id} projectName={project.name} version={versions[project.id] ?? 0} onOpen={(p) => open(project.id, p)} />}
        <div className="statusbar">
          <button className={termOpen ? "on" : ""} onClick={() => setTermOpen((o) => !o)} title="Ctrl+`"><Icon name="terminal" size={14} /> Terminal</button>
          <button onClick={() => setDockerOpen(true)} title="Docker">
            <Icon name="docker" size={14} /> Docker
            {docker?.state === "running" && <span className={"dk-badge" + (docker.running ? "" : " off")}>{docker.running}</span>}
          </button>
        </div>
      </aside>
      <Resizer onStart={() => (base.current = eff.side)} onDrag={grow("side", 1, 200)} />
      {tab && (
        <main className="main">
          <div className="tabs">
            {tabs.map((t, i) => (
              <div key={t.key} className={"tab" + (t.key === active ? " on" : "")} title={`${nameOf[t.project] ?? ""}/${t.path}`}
                onClick={() => { setActive(t.key); setActiveId(t.project); }}
                onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, index: i }); }}>
                {t.path.split("/").pop()}{t.dirty ? " ●" : ""}
                {projects.length > 1 && <span className="tab-proj" style={projectTint(projects, t.project)}>{nameOf[t.project]}</span>}
                <span className="x" onClick={(e) => { e.stopPropagation(); close(t.key); }}><Icon name="x" size={13} /></span>
              </div>
            ))}
          </div>
          <Editor
            key={tab.key} path={tab.path} content={tab.content} onSave={save}
            onChange={(v) => setTabs((ts) => ts.map((t) => (t.key === tab.key ? { ...t, dirty: true, content: v } : t)))}
          />
        </main>
      )}
      {termOpen && project && (<>
        {tab && <Resizer onStart={() => (base.current = eff.term)} onDrag={grow("term", -1, 260)} />}
        <TerminalPanel project={project} width={tab ? eff.term : undefined} onClose={() => setTermOpen(false)} run={termRun} />
      </>)}
      {panes > 0 && <Resizer onStart={() => (base.current = eff.chat)} onDrag={grow("chat", -1, 300)} />}
      <ChatPanel projects={projects} projectId={activeId} onFocusProject={setActiveId} onStatus={setStatus}
        accounts={accounts} refreshAccounts={refreshAccounts} openSettings={() => setSettingsOpen(true)} onRunInTerminal={runInTerminal}
        project={project} remote={project ? remote[project.id] : undefined} width={panes ? eff.chat : undefined} />
      {quickOpen && project && (
        <QuickOpen project={project}
          recent={tabs.filter((t) => t.project === project.id).map((t) => t.path).reverse()}
          onOpen={(path) => open(project.id, path)} onClose={() => setQuickOpen(false)} />
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={tabMenu(tabs.map((t) => t.key), ctx.index, closeTabs)} />}
      {tunnelFor && projects.find((p) => p.id === tunnelFor) && <TunnelModal project={projects.find((p) => p.id === tunnelFor)!} tunnels={tunnels} onClose={() => setTunnelFor("")} />}
      {pgFor && projects.find((p) => p.id === pgFor) && <PostgresPanel project={projects.find((p) => p.id === pgFor)!} onClose={() => setPgFor("")} />}
      {dockerOpen && project && <DockerPanel project={project.id} projectName={project.name} onClose={() => setDockerOpen(false)} onStatus={setDocker} />}
      {projectsLoaded && projects.length === 0 && !settingsOpen && (
        <WelcomeModal accounts={accounts} onAdded={setActiveId} onSignIn={() => setSettingsOpen(true)} />
      )}
      {settingsOpen && <SettingsModal accounts={accounts} refresh={refreshAccounts} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
