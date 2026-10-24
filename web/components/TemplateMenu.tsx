import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

// ---- Two-key shortcuts: one modifier + one letter/digit, stored as "Alt+1", "Ctrl+K", "Meta+J" ----
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
// Combos the app or the OS already uses (clipboard, quick open, find, save, window/tab handling, ...).
const RESERVED = new Set("ACVXZYFGPSWQRTNLHM".split(""));
const keyOf = (e: KeyboardEvent) => (/^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit([0-9])$/.exec(e.code)?.[1] ?? "");
const comboOf = (e: KeyboardEvent): string => {
  if (e.shiftKey) return "";
  const k = keyOf(e); if (!k) return "";
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.metaKey && "Meta"].filter(Boolean) as string[];
  return mods.length === 1 ? `${mods[0]}+${k}` : "";
};
const reservedCombo = (c: string) => { const [m, k] = c.split("+"); return (m === "Ctrl" || m === "Meta") && RESERVED.has(k); };
const pretty = (c: string) => { const [m, k] = c.split("+"); return isMac ? ({ Ctrl: "⌃", Alt: "⌥", Meta: "⌘" } as Record<string, string>)[m] + k : `${m}+${k}`; };

type Template = { id: string; title: string; text: string; shortcut?: string };
type Data = { prompts: Template[]; terminals: Template[] };
type Kind = "prompts" | "terminals";
type Draft = { id?: string; title: string; text: string; shortcut?: string };

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
  const [recording, setRecording] = useState(false);
  const onSendRef = useRef(onSend); onSendRef.current = onSend;
  const dataRef = useRef(data); dataRef.current = data;

  // Prompt shortcuts work from anywhere (menu open or not), so the templates are loaded up front.
  useEffect(() => { api<Data>("/api/templates").then(setData).catch(() => {}); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement | null)?.closest?.("[data-shortcut-rec]")) return;
      const c = comboOf(e); if (!c) return;
      const t = dataRef.current?.prompts.find((p) => p.shortcut === c);
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      onSendRef.current(t.text);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

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
    const item: Template = { id: draft.id ?? crypto.randomUUID().slice(0, 8), title: draft.title.trim(), text: draft.text.replace(/\s+$/, ""), ...(!isTerm && draft.shortcut ? { shortcut: draft.shortcut } : {}) };
    const list = draft.id ? data[kind].map((t) => (t.id === draft.id ? item : t)) : [...data[kind], item];
    void save({ ...data, [kind]: list });
    setDraft(null);
  };
  // The shortcut field: press the combo to set it; Backspace/Delete clears it.
  const recordKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!draft) return;
    if (e.key === "Tab") return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { (e.target as HTMLElement).blur(); return; }
    if (e.key === "Backspace" || e.key === "Delete") { setDraft({ ...draft, shortcut: undefined }); setError(""); return; }
    const c = comboOf(e.nativeEvent);
    if (!c) { if (!["Control", "Alt", "Meta", "Shift"].includes(e.key)) setError("Use one modifier plus one letter or digit, e.g. " + pretty("Alt+1")); return; }
    if (reservedCombo(c)) { setError(`${pretty(c)} is already used by the app or the system. Try ${pretty("Alt+" + c.split("+")[1])}.`); return; }
    const clash = data?.prompts.find((p) => p.shortcut === c && p.id !== draft.id);
    if (clash) { setError(`${pretty(c)} is already set on “${clash.title}”.`); return; }
    setError(""); setDraft({ ...draft, shortcut: c }); (e.target as HTMLElement).blur();
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
              {!isTerm && (
                <div className="tpl-sc">
                  <span>Shortcut</span>
                  <button type="button" data-shortcut-rec className={"tpl-sc-in" + (recording ? " rec" : "") + (draft.shortcut ? " set" : "")}
                    onFocus={() => setRecording(true)} onBlur={() => setRecording(false)} onKeyDown={recordKey}
                    title="Click, then press a modifier + key. Backspace clears it.">
                    {recording ? "Press keys…" : draft.shortcut ? pretty(draft.shortcut) : "None"}
                  </button>
                  {draft.shortcut && <button type="button" className="g-icon" style={{ visibility: "visible" }} title="Clear" onClick={() => setDraft({ ...draft, shortcut: undefined })}><Icon name="x" size={12} /></button>}
                  <small>Sends this prompt from anywhere</small>
                </div>
              )}
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
                    {t.shortcut && <kbd className="tpl-kbd" title="Keyboard shortcut">{pretty(t.shortcut)}</kbd>}
                    <span className="tpl-tools">
                      <button className="g-icon" style={{ visibility: "visible" }} title="Edit" onClick={() => setDraft({ id: t.id, title: t.title, text: t.text, shortcut: t.shortcut })}><Icon name="pencil" size={13} /></button>
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
