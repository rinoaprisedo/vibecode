import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { BranchMenu } from "./BranchMenu";
import { Icon } from "./Icon";

type File = { x: string; y: string; path: string };
type Status = { branch: string; files: File[] };

const LABEL: Record<string, string> = { M: "M", A: "A", D: "D", R: "R", C: "C", "?": "U" };

// Split "dir/sub/name.ext" into the name and its (dimmed) folder.
const split = (p: string) => {
  const trimmed = p.replace(/\/$/, ""); // untracked folders come as "dir/"
  const i = trimmed.lastIndexOf("/");
  return { name: trimmed.slice(i + 1) + (trimmed === p ? "" : "/"), dir: i < 0 ? "" : trimmed.slice(0, i) };
};

function Section({ title, files, staged, selected, onSelect, onToggle, onToggleAll }: {
  title: string; files: File[]; staged: boolean; selected: string;
  onSelect: (f: File) => void; onToggle: (f: File) => void; onToggleAll: () => void;
}) {
  if (!files.length) return null;
  return (
    <div className="g-section">
      <div className="g-title">
        <span>{title}</span>
        <span className="g-count">{files.length}</span>
        <button className="g-icon" title={staged ? "Unstage all" : "Stage all"} onClick={onToggleAll}><Icon name={staged ? "minus" : "plus"} size={14} /></button>
      </div>
      {files.map((f) => {
        const code = staged ? f.x : f.y;
        const { name, dir } = split(f.path);
        return (
          <div key={f.path} className={"g-row" + (selected === `${staged}:${f.path}` ? " sel" : "")} onClick={() => onSelect(f)} title={f.path}>
            <span className="g-name">{name}</span>
            <span className="g-dir">{dir}</span>
            <button className="g-icon" title={staged ? "Unstage" : "Stage"} onClick={(e) => { e.stopPropagation(); onToggle(f); }}>{staged ? "−" : "+"}</button>
            <span className={`g-code c-${LABEL[code] ?? code}`}>{LABEL[code] ?? code}</span>
          </div>
        );
      })}
    </div>
  );
}

export function GitPanel({ project, projectName, version, onOpen }: { project: string; projectName: string; version: number; onOpen: (p: string) => void }) {
  const call = <T = any,>(path: string, opts: { method?: string; body?: unknown } = {}) => api<T>(path, { ...opts, project });
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState("");
  const [sel, setSel] = useState("");
  const [msg, setMsg] = useState("");
  const [pushing, setPushing] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () =>
    call<Status>("/api/git/status").then((s) => { setStatus(s); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, [version]);

  const run = (fn: () => Promise<unknown>) => fn().then(refresh).catch((e) => setError(e.message));

  if (error) return (
    <div className="git">
      <div className="err">{error}</div>
      <button onClick={() => run(() => call("/api/git/init", { body: {} }))}>git init</button>
    </div>
  );

  const files = status?.files ?? [];
  const stagedFiles = files.filter((f) => f.x !== " " && f.x !== "?");
  const changes = files.filter((f) => f.y !== " ");

  const branch = status?.branch ?? "";
  const upstream = branch.includes("...") ? branch.split("...")[1].split(" ")[0] : "";
  const ahead = Number(/ahead (\d+)/.exec(branch)?.[1] ?? 0);

  const select = (f: File, staged: boolean) => {
    setSel(`${staged}:${f.path}`);
    if (f.x !== "?") onOpen(f.path);
    call(`/api/git/diff?path=${encodeURIComponent(f.path)}&staged=${staged ? 1 : 0}`).then((d) => setDiff(d.diff));
  };
  const toggle = (f: File, staged: boolean) =>
    run(() => call(staged ? "/api/git/unstage" : "/api/git/stage", { body: { path: f.path } }));
  const toggleAll = (list: File[], staged: boolean) =>
    run(() => Promise.all(list.map((f) => call(staged ? "/api/git/unstage" : "/api/git/stage", { body: { path: f.path } }))));
  const push = () => {
    setPushing(true); setNote(null);
    call("/api/git/push", { body: {} })
      .then(() => setNote({ ok: true, text: "Pushed" }))
      .catch((e) => setNote({ ok: false, text: e.message }))
      .finally(() => { setPushing(false); refresh(); });
  };
  const commit = () =>
    run(async () => { await call("/api/git/commit", { body: { message: msg } }); setMsg(""); setDiff(""); setSel(""); });

  return (
    <div className="git">
      <div className="g-proj"><Icon name="folder" size={13} /> {projectName}</div>
      <div className="g-branch">
        <BranchMenu project={project} current={status?.branch.replace(/^No commits yet on /, "").split("...")[0].split(" ")[0] ?? ""}
          onDone={() => { setNote(null); refresh(); }} onError={(text) => setNote({ ok: false, text })} />
        <button className="g-push" disabled={pushing || !!status?.branch.startsWith("No commits")} onClick={push}
          title={upstream ? "Push to " + upstream : "Publish branch to origin"}>
          <Icon name="upload" size={13} /> {pushing ? "Pushing…" : upstream ? `Push${ahead ? ` ${ahead}` : ""}` : "Publish"}
        </button>
      </div>
      {note && <div className={note.ok ? "g-note ok" : "g-note err"} onClick={() => setNote(null)}>{note.text}</div>}
      <div className="g-commit">
        <textarea rows={2} placeholder="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && msg && stagedFiles.length) commit(); }} />
        <button className="primary" disabled={!msg || !stagedFiles.length} onClick={commit}>
          Commit{stagedFiles.length ? ` (${stagedFiles.length})` : ""}
        </button>
      </div>
      <Section title="Staged Changes" files={stagedFiles} staged selected={sel}
        onSelect={(f) => select(f, true)} onToggle={(f) => toggle(f, true)} onToggleAll={() => toggleAll(stagedFiles, true)} />
      <Section title="Changes" files={changes} staged={false} selected={sel}
        onSelect={(f) => select(f, false)} onToggle={(f) => toggle(f, false)} onToggleAll={() => toggleAll(changes, false)} />
      {!files.length && <div className="muted">No changes</div>}
      {diff && (
        <pre className="diff">
          {diff.split("\n").map((l, i) => (
            <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : ""}>{l || " "}</div>
          ))}
        </pre>
      )}
    </div>
  );
}
