import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

export type ChatMeta = { id: string; title: string; updatedAt: number };

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// Dropdown listing saved sessions for the current folder.
export function ChatHistory({ project, projectName, currentId, refreshKey, status, onOpen, onDeleted }: {
  project: string; projectName: string;
  currentId: string; refreshKey: number; status: Record<string, "busy" | "waiting">;
  onOpen: (id: string) => void; onDeleted: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api<ChatMeta[]>("/api/chats", { project }).then(setChats).catch(() => setChats([]));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, refreshKey, project]);

  const del = (id: string) =>
    api(`/api/chats/${id}`, { method: "DELETE", project }).then(() => {
      setChats((c) => c.filter((x) => x.id !== id));
      onDeleted(id);
    });

  return (
    <div className="history" ref={ref}>
      <button className="g-icon tbtn" style={{ visibility: "visible" }} onClick={() => setOpen(!open)} title="Session history">
        <Icon name="history" size={16} />
      </button>
      {open && (
        <div className="menu hmenu">
          <div className="menu-head"><span>Sessions</span><span className="muted">{projectName}</span></div>
          <div className="h-list">
            {chats.length === 0 && <div className="muted">No saved sessions yet</div>}
            {chats.map((c) => (
              <div key={c.id} className={"b-item" + (c.id === currentId ? " on" : "")} onClick={() => { setOpen(false); onOpen(c.id); }}>
                {status[c.id] && <span className={"h-dot " + status[c.id]} title={status[c.id] === "busy" ? "Running" : "Waiting for approval"} />}
                <span className="h-name">{c.title}</span>
                <span className="muted h-time">{ago(c.updatedAt)}</span>
                <span className="x" title="Delete" onClick={(e) => { e.stopPropagation(); del(c.id); }}><Icon name="x" size={14} /></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
