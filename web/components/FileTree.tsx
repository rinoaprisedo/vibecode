import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

type Entry = { name: string; dir: boolean };

function Dir({ project, path, depth, onOpen, version }: { project: string; path: string; depth: number; onOpen: (p: string) => void; version: number }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api<Entry[]>(`/api/tree?path=${encodeURIComponent(path)}`, { project }).then(setEntries).catch(() => setEntries([]));
  }, [path, version]);
  return (
    <>
      {entries.map((e) => {
        const full = path ? `${path}/${e.name}` : e.name;
        return (
          <div key={full}>
            <div
              className="row"
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => (e.dir ? setOpen({ ...open, [full]: !open[full] }) : onOpen(full))}
            >
              {e.dir
                ? <><Icon name={open[full] ? "chevronDown" : "chevronRight"} size={14} className="chev" /><Icon name={open[full] ? "folderOpen" : "folder"} size={15} className="ico-folder" /></>
                : <><span className="chev" /><Icon name="file" size={15} className="ico-file" /></>}
              <span className="r-name">{e.name}</span>
            </div>
            {e.dir && open[full] && <Dir project={project} path={full} depth={depth + 1} onOpen={onOpen} version={version} />}
          </div>
        );
      })}
    </>
  );
}

export type ProjectInfo = { id: string; root: string; name: string };

// One section per open folder (like a multi-root workspace). Clicking a section's header focuses
// that project: chat, git and new terminals follow it.
export function FileTree({ projects, activeId, versions, status, remote, onActivate, onRemove, onOpen }: {
  projects: ProjectInfo[]; activeId: string; versions: Record<string, number>;
  status: Record<string, "busy" | "waiting">;
  remote: Record<string, { status: string }>;
  onActivate: (id: string) => void; onRemove: (id: string) => void;
  onOpen: (project: string, path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="tree">
      {projects.length === 0 && <div className="empty-hint">No folder open yet.<br />Use <b>Add folder</b> above to start.</div>}
      {projects.map((p) => (
        <div key={p.id} className="proj">
          <div className={"proj-head" + (p.id === activeId ? " active" : "")} title={p.root}
            onClick={() => { onActivate(p.id); setCollapsed((c) => ({ ...c, [p.id]: p.id === activeId ? !c[p.id] : false })); }}>
            <Icon name={collapsed[p.id] ? "chevronRight" : "chevronDown"} size={14} className="chev" />
            <span className="p-name">{p.name}</span>
            {remote[p.id]?.status === "connected" && <span className="p-remote" title="Remote Control is on: reachable from the Claude app"><Icon name="phone" size={12} /></span>}
            {status[p.id] && <span className={"h-dot " + status[p.id]} title={status[p.id] === "busy" ? "Claude is working here" : "Waiting for approval"} />}
            {projects.length > 1 && (
              <span className="x p-x" title="Close folder" onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}><Icon name="x" size={13} /></span>
            )}
          </div>
          {!collapsed[p.id] && <Dir project={p.id} path="" depth={0} onOpen={(path) => onOpen(p.id, path)} version={versions[p.id] ?? 0} />}
        </div>
      ))}
    </div>
  );
}
