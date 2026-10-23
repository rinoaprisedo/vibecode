import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

type Template = { id: string; title: string; text: string };
type Data = { prompts: Template[]; terminals: Template[] };
type Kind = "prompts" | "terminals";
type Draft = { id?: string; title: string; text: string };

// Popup in the composer bar: reusable prompts (send, or drop into the message box) and terminal commands (run in a new terminal tab).
export function TemplateMenu({ onSend, onToChat, onRun }: {
  onSend: (text: string) => void; onToChat: (text: string) => void; onRun: (title: string, command: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("prompts");
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [delId, setDelId] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { if (draft) setDraft(null); else setOpen(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open, draft]);

  useEffect(() => {
    if (open && !data) api<Data>("/api/templates").then(setData).catch((e) => setError(e.message));
  }, [open]);
  useEffect(() => { setQ(""); setDraft(null); setDelId(""); }, [kind, open]);
  useEffect(() => { if (!delId) return; const t = setTimeout(() => setDelId(""), 3000); return () => clearTimeout(t); }, [delId]);

  const save = async (next: Data) => {
    setData(next);                                            // optimistic; the server's cleaned copy replaces it
    try { setData(await api<Data>("/api/templates", { method: "PUT", body: next })); setError(""); }
    catch (e: any) { setError(e.message); }
  };
  const commit = () => {
    if (!draft || !data || !draft.title.trim() || !draft.text.trim()) return;
    const item: Template = { id: draft.id ?? crypto.randomUUID().slice(0, 8), title: draft.title.trim(), text: draft.text.replace(/\s+$/, "") };
    const list = draft.id ? data[kind].map((t) => (t.id === draft.id ? item : t)) : [...data[kind], item];
    void save({ ...data, [kind]: list });
    setDraft(null);
  };
  const remove = (id: string) => { if (data) void save({ ...data, [kind]: data[kind].filter((t) => t.id !== id) }); setDelId(""); };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.[kind] ?? []).filter((t) => !needle || (t.title + " " + t.text).toLowerCase().includes(needle));
  }, [data, kind, q]);
  const isTerm = kind === "terminals";

  return (
    <div className="modemenu" ref={ref}>
      {open && (
        <div className="menu tpl-menu">
          <div className="tpl-head">
            <div className="tpl-tabs">
              <button className={kind === "prompts" ? "on" : ""} onClick={() => setKind("prompts")}><Icon name="sparkle" size={13} /> Prompts</button>
              <button className={kind === "terminals" ? "on" : ""} onClick={() => setKind("terminals")}><Icon name="terminal" size={13} /> Terminal</button>
            </div>
            <span style={{ flex: 1 }} />
            {!draft && <button className="tpl-new" onClick={() => setDraft({ title: "", text: "" })}><Icon name="plus" size={13} /> New</button>}
          </div>

          {error && <div className="err">{error}</div>}

          {draft ? (
            <div className="tpl-form">
              <input autoFocus placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <textarea rows={isTerm ? 3 : 6} spellCheck={false} placeholder={isTerm ? "Command(s) to run, e.g. docker compose up -d" : "The prompt text…"}
                className={isTerm ? "mono" : ""} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
              <div className="tpl-form-btns">
                <button onClick={() => setDraft(null)}>Cancel</button>
                <button className="primary" disabled={!draft.title.trim() || !draft.text.trim()} onClick={commit}>{draft.id ? "Save" : "Add template"}</button>
              </div>
            </div>
          ) : (<>
            {(data?.[kind].length ?? 0) > 5 && (
              <div className="tpl-search"><Icon name="search" size={13} /><input placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            )}
            <div className="tpl-list">
              {!data && !error && <div className="muted">Loading…</div>}
              {data && !list.length && (
                <div className="tpl-empty">{q ? "No templates match." : `No ${isTerm ? "terminal" : "prompt"} templates yet.`}<br /><span>Click “New” to add one.</span></div>
              )}
              {list.map((t) => (
                <div key={t.id} className="tpl-item">
                  <div className="tpl-top">
                    <b title={t.title}>{t.title}</b>
                    <span className="tpl-tools">
                      <button className="g-icon" style={{ visibility: "visible" }} title="Edit" onClick={() => setDraft({ id: t.id, title: t.title, text: t.text })}><Icon name="pencil" size={13} /></button>
                      {delId === t.id
                        ? <button className="danger tpl-del" onClick={() => remove(t.id)}>Delete?</button>
                        : <button className="g-icon" style={{ visibility: "visible" }} title="Delete" onClick={() => setDelId(t.id)}><Icon name="trash" size={13} /></button>}
                    </span>
                  </div>
                  <div className={"tpl-text" + (isTerm ? " mono" : "")} title={t.text}>{isTerm ? "$ " : ""}{t.text}</div>
                  <div className="tpl-actions">
                    {isTerm
                      ? <button className="primary" title="Open the terminal and run it" onClick={() => { onRun(t.title, t.text); setOpen(false); }}><Icon name="play" size={12} /> Run in terminal</button>
                      : <>
                          <button title="Put it in the message box so you can edit it first" onClick={() => { onToChat(t.text); setOpen(false); }}><Icon name="pencil" size={12} /> To chat</button>
                          <button className="primary" title="Send it to Claude right now" onClick={() => { onSend(t.text); setOpen(false); }}><Icon name="send" size={12} /> Send</button>
                        </>}
                  </div>
                </div>
              ))}
            </div>
          </>)}
        </div>
      )}
      <button className="modebtn iconbtn" onClick={() => setOpen(!open)} title="Templates: prompts & terminal commands"><Icon name="bookmark" size={16} /></button>
    </div>
  );
}
