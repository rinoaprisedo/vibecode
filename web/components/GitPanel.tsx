import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { BranchMenu } from "./BranchMenu";
import { Icon } from "./Icon";
import { GitFix, classifyGitError, type FixKind } from "./GitFix";

type File = { x: string; y: string; path: string };
type Status = { branch: string; files: File[] };

const TITLE: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", "?": "Untracked" };
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
            <span className={`g-code c-${LABEL[code] ?? code}`} title={TITLE[code] ?? code}>{LABEL[code] ?? code}</span>
            <span className="g-name">{name}</span>
            <span className="g-dir">{dir}</span>
            <button className="g-icon" title={staged ? "Unstage" : "Stage"} onClick={(e) => { e.stopPropagation(); onToggle(f); }}><Icon name={staged ? "minus" : "plus"} size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

export function GitPanel({ project, projectName, version, onOpen }: { project: string; projectName: string; version: number; onOpen: (p: string) => void }) {
  const call = <T = any,>(path: string, opts: { method?: string; body?: unknown } = {}) => api<T>(path, { ...opts, project });
  const [status, setStatus] = useState<Status | null>(null);
  const [notRepo, setNotRepo] = useState(false);
  const [diff, setDiff] = useState("");
  const [sel, setSel] = useState("");
  const [msg, setMsg] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  type Note = { ok: boolean; text: string; fix?: FixKind; retry?: () => void; retryLabel?: string };
  const [note, setNote] = useState<Note | null>(null);
  // A failed commit / push / pull that git can't do yet (no name, no sign-in, no remote) becomes a guided fix instead of raw text.
  const fail = (text: string, retry?: () => void, retryLabel = "retry") => setNote({ ok: false, text, fix: retry ? classifyGitError(text) ?? undefined : undefined, retry, retryLabel });

  // Only "this folder isn't a repo" replaces the panel; any other git error is a message on top of the last good state.
  const refresh = () =>
    call<Status>("/api/git/status")
      .then((s) => { setStatus(s); setNotRepo(false); })
      .catch((e) => { if (/not a git repository/i.test(e.message)) setNotRepo(true); else setNote({ ok: false, text: e.message }); });
  useEffect(() => { refresh(); }, [version]);

  const run = (fn: () => Promise<unknown>, retry?: () => void, retryLabel?: string) => fn().then(refresh).catch((e) => { fail(e.message, retry, retryLabel); refresh(); });

  if (notRepo) return (
    <div className="git">
      <div className="empty-hint">This folder isn't a git repository yet.</div>
      <div style={{ textAlign: "center" }}><button className="primary" onClick={() => run(() => call("/api/git/init", { body: {} }))}>git init</button></div>
    </div>
  );

  const files = status?.files ?? [];
  const stagedFiles = files.filter((f) => f.x !== " " && f.x !== "?");
  const changes = files.filter((f) => f.y !== " ");

  const branch = status?.branch ?? "";
  const upstream = branch.includes("...") ? branch.split("...")[1].split(" ")[0] : "";
  const behind = Number(/behind (\d+)/.exec(branch)?.[1] ?? 0);
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
      .catch((e) => fail(e.message, push, "push"))
      .finally(() => { setPushing(false); refresh(); });
  };
  const pull = () => {
    setPulling(true); setNote(null);
    call("/api/git/pull", { body: {} })
      .then((r: any) => setNote({ ok: true, text: /already up to date/i.test(r?.out ?? "") ? "Already up to date" : "Pulled latest changes" }))
      .catch((e) => fail(e.message, pull, "pull"))
      .finally(() => { setPulling(false); refresh(); });
  };
  // Stages every change (new files included) and commits them in one go.
  const commit = () =>
    run(async () => { await call("/api/git/commit", { body: { message: msg } }); setMsg(""); setDiff(""); setSel(""); setNote({ ok: true, text: "Committed" }); }, commit, "commit");
  const locked = !!note && !note.ok && /index\.lock|another git process/i.test(note.text);
  const unlock = () => call("/api/git/unlock", { body: {} }).then(() => { setNote(null); refresh(); }).catch((e) => setNote({ ok: false, text: e.message }));

  return (
    <div className="git">
      <div className="g-head">
        <div className="g-proj"><Icon name="folder" size={12} /> {projectName}</div>
        <div className="g-branch">
          <BranchMenu project={project} current={status?.branch.replace(/^No commits yet on /, "").split("...")[0].split(" ")[0] ?? ""}
            onDone={() => { setNote(null); refresh(); }} onError={(text) => setNote({ ok: false, text })} />
          <button className="g-push g-pull" disabled={pulling || pushing || !upstream} onClick={pull}
            title={upstream ? "Pull from " + upstream : "No upstream branch to pull from"}>
            <Icon name="download" size={13} /> {pulling ? "Pulling…" : `Pull${behind ? ` ${behind}` : ""}`}
          </button>
          <button className="g-push" disabled={pushing || !!status?.branch.startsWith("No commits")} onClick={push}
            title={upstream ? "Push to " + upstream : "Publish branch to origin"}>
            <Icon name="upload" size={13} /> {pushing ? "Pushing…" : upstream ? `Push${ahead ? ` ${ahead}` : ""}` : "Publish"}
          </button>
        </div>
      </div>
      {note?.fix && note.retry && (
        <GitFix kind={note.fix} raw={note.text} project={project} retryLabel={note.retryLabel ?? "retry"}
          onClose={() => setNote(null)} onFixed={() => { const again = note.retry!; setNote(null); again(); }} />
      )}
      {note && !(note.fix && note.retry) && (
        <div className={note.ok ? "g-note ok" : "g-note err"} onClick={() => setNote(null)}>
          {locked ? "Git is busy (index.lock exists). If nothing is running, the lock is stale." : note.text}
          {locked && <button className="g-unlock" onClick={(e) => { e.stopPropagation(); unlock(); }}>Remove stale lock & retry</button>}
        </div>
      )}
      <div className="g-commit">
        <textarea rows={2} placeholder="Commit message  (⌘↵ to commit)" value={msg} onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && msg && files.length) commit(); }} />
        <button className="primary" disabled={!msg || !files.length} onClick={commit} title="Stages all changes, then commits">
          Commit all{files.length ? ` (${files.length})` : ""}
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
