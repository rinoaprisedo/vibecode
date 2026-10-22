import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

type Recent = { root: string; name: string };

// "Add folder": pick a new one, or re-open a folder you closed earlier with a single click.
export function AddFolderMenu({ onAdded }: { onAdded: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api<Recent[]>("/api/projects/recent").then(setRecent).catch(() => setRecent([]));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const add = (path?: string) => {
    setOpen(false);
    api<{ id?: string }>("/api/projects", { body: path ? { path } : {} })
      .then((r) => r.id && onAdded(r.id))
      .catch((e) => alert(e.message));
  };

  return (
    <div className="addfolder" ref={ref}>
      <button onClick={() => setOpen(!open)} title="Open another folder"><Icon name="plus" size={14} /> Add folder</button>
      {open && (
        <div className="menu fmenu">
          <div className="b-item new" onClick={() => add()}><Icon name="folderOpen" size={14} /> Choose folder…</div>
          {recent.length > 0 && <div className="menu-head"><span>Recent</span></div>}
          <div className="b-list">
            {recent.map((r) => (
              <div key={r.root} className="b-item" title={r.root} onClick={() => add(r.root)}>
                <span className="h-name">{r.name}</span>
                <span className="muted h-time r-path">{r.root.replace(/^\/Users\/[^/]+/, "~")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
