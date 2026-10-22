import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { ContextMenu, type MenuItem } from "./ContextMenu";

type Entry = { name: string; dir: boolean };
export type ProjectInfo = { id: string; root: string; name: string };

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

type Target = { project: string; path: string; dir: boolean };               // path "" = the project folder itself
type Clip = { mode: "copy" | "cut"; items: { project: string; path: string }[] };
type Edit = { kind: "rename" | "file" | "folder"; project: string; path: string }; // rename: the item; file/folder: the parent dir

type TreeCtx = {
  selected: Target | null;
  editing: Edit | null;
  cut: Set<string>;
  isOpen: (project: string, path: string) => boolean;
  toggle: (project: string, path: string) => void;
  select: (t: Target) => void;
  openFile: (project: string, path: string) => void;
  menu: (e: React.MouseEvent, t: Target) => void;
  commit: (name: string) => void;
  cancel: () => void;
  bump: Record<string, number>;
};
const Ctx = createContext<TreeCtx>(null as unknown as TreeCtx);

// Inline name box used for rename / new file / new folder (Enter = confirm, Esc or click away = cancel).
function NameInput({ initial, depth, folder, file }: { initial: string; depth: number; folder?: boolean; file?: boolean }) {
  const { commit, cancel } = useContext(Ctx);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length); // select the name, keep the extension
  }, []);
  return (
    <div className="row editing" style={{ paddingLeft: 10 + depth * 14 }}>
      <span className="chev" />
      <Icon name={folder ? "folder" : "file"} size={15} className={folder ? "ico-folder" : "ico-file"} />
      <input ref={ref} className="name-input" defaultValue={initial} spellCheck={false}
        placeholder={file ? "File name" : folder ? "Folder name" : ""}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(e.currentTarget.value); else if (e.key === "Escape") cancel(); }}
        onBlur={cancel} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

function Dir({ project, path, depth, version }: { project: string; path: string; depth: number; version: number }) {
  const t = useContext(Ctx);
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    api<Entry[]>(`/api/tree?path=${encodeURIComponent(path)}`, { project }).then(setEntries).catch(() => setEntries([]));
  }, [path, version, t.bump[project]]);

  const creating = t.editing && t.editing.kind !== "rename" && t.editing.project === project && t.editing.path === path ? t.editing : null;
  return (
    <>
      {creating && <NameInput initial="" depth={depth} folder={creating.kind === "folder"} file={creating.kind === "file"} />}
      {entries.map((e) => {
        const full = join(path, e.name);
        const open = e.dir && t.isOpen(project, full);
        const renaming = t.editing?.kind === "rename" && t.editing.project === project && t.editing.path === full;
        const sel = t.selected?.project === project && t.selected.path === full;
        return (
          <div key={full}>
            {renaming ? <NameInput initial={e.name} depth={depth} folder={e.dir} /> : (
              <div className={"row" + (sel ? " selected" : "") + (t.cut.has(`${project}:${full}`) ? " cut" : "")} style={{ paddingLeft: 10 + depth * 14 }}
                onClick={() => { t.select({ project, path: full, dir: e.dir }); if (e.dir) t.toggle(project, full); else t.openFile(project, full); }}
                onContextMenu={(ev) => t.menu(ev, { project, path: full, dir: e.dir })}>
                {e.dir
                  ? <><Icon name={open ? "chevronDown" : "chevronRight"} size={14} className="chev" /><Icon name={open ? "folderOpen" : "folder"} size={15} className="ico-folder" /></>
                  : <><span className="chev" /><Icon name="file" size={15} className="ico-file" /></>}
                <span className="r-name">{e.name}</span>
              </div>
            )}
            {open && <Dir project={project} path={full} depth={depth + 1} version={version} />}
          </div>
        );
      })}
    </>
  );
}

// One section per open folder (like a multi-root workspace). Clicking a section's header focuses
// that project: chat, git and new terminals follow it. Right-click files and folders for file operations.
export function FileTree({ projects, activeId, versions, status, remote, onActivate, onRemove, onOpen, onChanged, onRenamed, onDeleted }: {
  projects: ProjectInfo[]; activeId: string; versions: Record<string, number>;
  status: Record<string, "busy" | "waiting">;
  remote: Record<string, { status: string }>;
  onActivate: (id: string) => void; onRemove: (id: string) => void;
  onOpen: (project: string, path: string) => void;
  onChanged: (project: string) => void;                                   // files changed on disk: refresh
  onRenamed: (project: string, from: string, to: string) => void;         // keep editor tabs pointing at moved files
  onDeleted: (project: string, path: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; t: Target } | null>(null);
  const [selected, setSelected] = useState<Target | null>(null);
  const [editing, setEditing] = useState<Edit | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [del, setDel] = useState<{ t: Target; permanent: boolean; note?: string } | null>(null);
  const [bump, setBump] = useState<Record<string, number>>({});
  // Projects start collapsed; folders remember being open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("vibecode.expanded") ?? "{}"); } catch { return {}; }
  });
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({});
  const proj = (id: string) => projects.find((p) => p.id === id);

  const toggleProject = (id: string, force?: boolean) => setExpanded((e) => {
    const next = { ...e, [id]: force ?? !e[id] };
    try { localStorage.setItem("vibecode.expanded", JSON.stringify(next)); } catch {}
    return next;
  });
  const refresh = (id: string) => { setBump((b) => ({ ...b, [id]: (b[id] ?? 0) + 1 })); onChanged(id); };
  const fail = (e: unknown) => alert(e instanceof Error ? e.message : String(e));

  // ----- actions -----
  const destDirOf = (t: Target) => (t.dir ? t.path : dirOf(t.path));    // new items / pastes go into the folder, or beside a file
  const startNew = (kind: "file" | "folder", t: Target) => {
    const dir = destDirOf(t);
    if (dir === "") toggleProject(t.project, true); else setOpenDirs((o) => ({ ...o, [`${t.project}:${dir}`]: true }));
    setEditing({ kind, project: t.project, path: dir });
  };
  const copyText = (text: string) => navigator.clipboard.writeText(text).catch(() => {});
  const setClipboard = (mode: Clip["mode"], t: Target) => setClip({ mode, items: [{ project: t.project, path: t.path }] });
  const paste = async (t: Target) => {
    if (!clip) return;
    const dir = destDirOf(t);
    try {
      const r = await api<{ created: string[] }>("/api/fs/paste", { body: { items: clip.items, dir, move: clip.mode === "cut" }, project: t.project });
      if (clip.mode === "cut") {
        clip.items.forEach((it, i) => it.project === t.project ? onRenamed(t.project, it.path, r.created[i]) : onDeleted(it.project, it.path));
        setClip(null);
      }
      new Set([t.project, ...clip.items.map((i) => i.project)]).forEach(refresh);
      if (dir) setOpenDirs((o) => ({ ...o, [`${t.project}:${dir}`]: true }));
    } catch (e) { fail(e); }
  };
  const commit = async (raw: string) => {
    const ed = editing; setEditing(null);
    const name = raw.trim();
    if (!ed || !name) return;
    try {
      if (ed.kind === "rename") {
        if (name === baseOf(ed.path)) return;
        const to = join(dirOf(ed.path), name);
        await api("/api/fs/rename", { body: { from: ed.path, to }, project: ed.project });
        onRenamed(ed.project, ed.path, to);
        setSelected({ project: ed.project, path: to, dir: selected?.dir ?? false });
      } else {
        const path = join(ed.path, name);
        await api("/api/fs/create", { body: { path, kind: ed.kind === "file" ? "file" : "dir" }, project: ed.project });
        if (ed.kind === "file") onOpen(ed.project, path);
      }
      refresh(ed.project);
    } catch (e) { fail(e); }
  };
  const doDelete = async () => {
    if (!del) return;
    const { t, permanent } = del;
    try {
      await api("/api/fs/delete", { body: { path: t.path, permanent }, project: t.project });
      onDeleted(t.project, t.path);
      setSelected(null); setDel(null); refresh(t.project);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Trash unavailable (for example Finder access was declined): offer a permanent delete instead.
      if (!permanent && /trash/i.test(msg)) setDel({ t, permanent: true, note: msg });
      else { setDel(null); fail(e); }
    }
  };

  const menuItems = (t: Target): MenuItem[] => {
    const root = t.path === "";
    const p = proj(t.project);
    return [
      { label: "New File…", onClick: () => startNew("file", t) },
      { label: "New Folder…", onClick: () => startNew("folder", t) },
      "sep",
      { label: "Cut", onClick: () => setClipboard("cut", t), disabled: root },
      { label: "Copy", onClick: () => setClipboard("copy", t), disabled: root },
      { label: "Paste", onClick: () => paste(t), disabled: !clip },
      "sep",
      { label: "Copy Path", onClick: () => copyText(root ? p!.root : `${p!.root}/${t.path}`) },
      { label: "Copy Relative Path", onClick: () => copyText(t.path), disabled: root },
      "sep",
      { label: "Rename…", onClick: () => setEditing({ kind: "rename", project: t.project, path: t.path }), disabled: root },
      { label: "Delete", onClick: () => setDel({ t, permanent: false }), disabled: root },
      ...(root ? ["sep" as const, { label: "Remove from Vibecode", onClick: () => onRemove(t.project) }] : []),
    ];
  };

  // ----- keyboard (while the explorer has focus): ⌘C / ⌘X / ⌘V, Enter or F2 = rename, Delete = delete -----
  const onKey = (e: React.KeyboardEvent) => {
    if (editing || !selected) return;
    const cmd = e.metaKey || e.ctrlKey;
    const isRoot = selected.path === "";
    if (cmd && e.key === "c" && !isRoot) { e.preventDefault(); setClipboard("copy", selected); }
    else if (cmd && e.key === "x" && !isRoot) { e.preventDefault(); setClipboard("cut", selected); }
    else if (cmd && e.key === "v") { e.preventDefault(); paste(selected); }
    else if ((e.key === "Enter" || e.key === "F2") && !isRoot) { e.preventDefault(); setEditing({ kind: "rename", project: selected.project, path: selected.path }); }
    else if ((e.key === "Delete" || (cmd && e.key === "Backspace")) && !isRoot) { e.preventDefault(); setDel({ t: selected, permanent: false }); }
  };

  const ctx: TreeCtx = {
    selected, editing, bump,
    cut: new Set(clip?.mode === "cut" ? clip.items.map((i) => `${i.project}:${i.path}`) : []),
    isOpen: (p, path) => !!openDirs[`${p}:${path}`],
    toggle: (p, path) => setOpenDirs((o) => ({ ...o, [`${p}:${path}`]: !o[`${p}:${path}`] })),
    select: setSelected,
    openFile: onOpen,
    menu: (e, t) => { e.preventDefault(); e.stopPropagation(); setSelected(t); setMenu({ x: e.clientX, y: e.clientY, t }); },
    commit, cancel: () => setEditing(null),
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="tree" tabIndex={0} onKeyDown={onKey}>
        {projects.length === 0 && <div className="empty-hint">No folder open yet.<br />Use <b>Add folder</b> above to start.</div>}
        {projects.map((p) => (
          <div key={p.id} className="proj">
            <div className={"proj-head" + (p.id === activeId ? " active" : "")} title={p.root}
              onClick={() => { onActivate(p.id); setSelected({ project: p.id, path: "", dir: true }); }} onDoubleClick={() => toggleProject(p.id)}
              onContextMenu={(e) => ctx.menu(e, { project: p.id, path: "", dir: true })}>
              <span className="chev-btn" title={expanded[p.id] ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); toggleProject(p.id); }}>
                <Icon name={expanded[p.id] ? "chevronDown" : "chevronRight"} size={14} className="chev" />
              </span>
              <span className="p-name">{p.name}</span>
              {remote[p.id]?.status === "connected" && <span className="p-remote" title="Remote Control is on: reachable from the Claude app"><Icon name="phone" size={12} /></span>}
              {status[p.id] && <span className={"h-dot " + status[p.id]} title={status[p.id] === "busy" ? "Claude is working here" : "Waiting for approval"} />}
              <span className="x p-x" title="Remove from Vibecode (the folder and its files stay on disk)" onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}><Icon name="x" size={13} /></span>
            </div>
            {expanded[p.id] && <Dir project={p.id} path="" depth={0} version={versions[p.id] ?? 0} />}
          </div>
        ))}
        {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.t)} />}
        {del && (
          <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDel(null)}>
            <div className="modal trust">
              <div className="modal-head"><h3>{del.permanent ? "Delete permanently?" : "Move to Trash?"}</h3></div>
              <div className="modal-body">
                <code className="trust-path">{baseOf(del.t.path)}{del.t.dir ? "/" : ""}</code>
                <p className="sec-note">
                  {del.note && <>{del.note}<br /></>}
                  {del.permanent
                    ? "This can't be undone. The item and everything inside it will be deleted from your disk."
                    : del.t.dir ? "The folder and everything inside it moves to the Trash. You can restore it from there." : "The file moves to the Trash. You can restore it from there."}
                </p>
                <div className="trust-actions">
                  <button onClick={() => setDel(null)}>Cancel</button>
                  <button className={del.permanent ? "danger-btn" : "primary"} autoFocus onClick={doDelete}>{del.permanent ? "Delete permanently" : "Move to Trash"}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
