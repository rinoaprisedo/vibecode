import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { search } from "../lib/fuzzy";
import { Icon } from "./Icon";

type Listing = { files: string[]; truncated: boolean };
const cache = new Map<string, { at: number; data: Listing }>(); // per project, so reopening is instant

// ⌘P: jump to any file of the focused project by typing a few letters of its name or path.
export function QuickOpen({ project, recent, onOpen, onClose }: {
  project: { id: string; name: string };
  recent: string[];                       // files open in the editor right now (most recent first)
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<Listing | null>(cache.get(project.id)?.data ?? null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hit = cache.get(project.id);
    if (hit && Date.now() - hit.at < 5000) return; // fresh enough
    api<Listing>("/api/files", { project: project.id }).then((d) => { cache.set(project.id, { at: Date.now(), data: d }); setData(d); }).catch(() => {});
  }, [project.id]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (!q.trim()) {
      // Nothing typed yet: files you have open first, then the rest alphabetically.
      const open = recent.filter((p) => data.files.includes(p));
      const rest = data.files.filter((p) => !open.includes(p)).slice(0, 60);
      return [...open, ...rest].map((path) => ({ path, score: 0, marks: new Set<number>() }));
    }
    return search(data.files, q);
  }, [data, q, recent]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(".qo-row.sel")?.scrollIntoView({ block: "nearest" }); }, [sel, rows]);

  const choose = (path?: string) => { if (path) { onOpen(path); onClose(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(rows[sel]?.path); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  // Bold the matched letters.
  const mark = (text: string, offset: number, marks: Set<number>) =>
    [...text].map((ch, i) => (marks.has(offset + i) ? <b key={i} className="qo-m">{ch}</b> : ch));

  return (
    <div className="qo-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qo" onKeyDown={onKey}>
        <div className="qo-input">
          <Icon name="search" size={15} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search files in ${project.name}…`} spellCheck={false} />
          <kbd>esc</kbd>
        </div>
        <div className="qo-list" ref={list}>
          {!data && <div className="muted">Loading files…</div>}
          {data && rows.length === 0 && <div className="muted">No matching files</div>}
          {rows.map((r, i) => {
            const slash = r.path.lastIndexOf("/") + 1;
            const isOpen = recent.includes(r.path);
            return (
              <div key={r.path} className={"qo-row" + (i === sel ? " sel" : "")} onMouseMove={() => setSel(i)} onClick={() => choose(r.path)}>
                <Icon name="file" size={14} className="ico-file" />
                <span className="qo-name">{mark(r.path.slice(slash), slash, r.marks)}</span>
                <span className="qo-dir">{mark(r.path.slice(0, slash).replace(/\/$/, ""), 0, r.marks)}</span>
                {isOpen && <span className="qo-open">open</span>}
              </div>
            );
          })}
          {data?.truncated && <div className="muted qo-note">Showing the first 30,000 files.</div>}
        </div>
        <div className="qo-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span>{rows.length ? `${rows.length}${q.trim() ? "" : "+"} file${rows.length === 1 && q.trim() ? "" : "s"}` : ""}</span></div>
      </div>
    </div>
  );
}
