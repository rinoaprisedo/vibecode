import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { api, connect, imageUrl, uploadImage } from "../lib/api";
import { isImage, MAX_ATTACHMENTS, toAttachment, type Attachment } from "../lib/images";
import { LoginFlow } from "./LoginFlow";
import { AccountMenu, type Account } from "./AccountMenu";
import { ModeMenu, nextMode, type Settings } from "./ModeMenu";
import { ChatHistory } from "./ChatHistory";
import { UsageBar, type Context } from "./UsageBar";
import { RemotePanel, type RemoteState } from "./RemotePanel";
import { ContextMenu, tabMenu } from "./ContextMenu";
import { ModelMenu } from "./ModelMenu";
import { TemplateMenu } from "./TemplateMenu";
import { Icon, type IconName } from "./Icon";
import { Markdown } from "./Markdown";
import { projectTint } from "../lib/projectColor";

const loadSettings = (): Settings => {
  try { return { mode: "manual", effort: "medium", ultracode: false, model: "", ...JSON.parse(localStorage.getItem("vibecode.settings") ?? "{}") }; }
  catch { return { mode: "manual", effort: "medium", ultracode: false, model: "" }; }
};

const autoSwitchOn = () => { try { return localStorage.getItem("vibecode.autoSwitch") !== "off"; } catch { return true; } };

type Item =
  | { kind: "user" | "text" | "error" | "notice"; text: string; images?: string[]; at?: number }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "permission"; id: string; tool: string; input: any; answered?: boolean };

// Everything about one session. Sessions keep running (and receiving events) while another is on screen.
type ChatState = { items: Item[]; busy: boolean; claudeSession?: string; context?: Context; project?: string; account?: string };
const EMPTY: ChatState = { items: [], busy: false };

const titleOf = (c?: ChatState) => {
  const u = c?.items.find((i) => i.kind === "user") as { text: string; images?: string[] } | undefined;
  return u ? (u.text.slice(0, 40) || (u.images?.length ? "Image" : "")) : "";
};

type Props = {
  projects: { id: string; name: string }[];
  projectId: string;                                  // focused project
  onFocusProject: (id: string) => void;
  onStatus: (s: Record<string, "busy" | "waiting">) => void; // which projects have a session running / waiting
  accounts: Account[];
  refreshAccounts: () => void;
  openSettings: () => void;
  project?: { id: string; name: string };            // focused project, for Remote Control
  remote?: RemoteState;
  width?: number;                                    // set when the chat is a resizable column
  onRunInTerminal: (title: string, command: string) => void; // terminal templates
};
type Tab = { id: string; project: string };

const TABS_KEY = "vibecode.chatTabs";

export function ChatPanel({ projects, projectId, onFocusProject, onStatus, accounts, refreshAccounts, openSettings, project, remote, width, onRunInTerminal }: Props) {
  // Every open chat tab keeps its own state and keeps running in the background.
  const [store, setStore] = useState<Record<string, ChatState>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [chatId, setChatId] = useState("");
  // Each chat tab keeps its own half-typed message, so switching tabs never loses it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const input = drafts[chatId] ?? "";
  const setInputFor = (id: string, v: string) => setDrafts((d) => (d[id] === v ? d : { ...d, [id]: v }));
  const setInput = (v: string) => setInputFor(chatId, v);
  const [ready, setReady] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // grow with the text up to a cap (about 40% of the window, max 320px), then scroll
  useLayoutEffect(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto";
    const max = Math.min(320, Math.round(window.innerHeight * 0.4));
    el.style.height = Math.min(Math.max(el.scrollHeight, 58), max) + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [input]);
  const [attached, setAttached] = useState<Record<string, Attachment[]>>({}); // pending images per chat tab
  const [dragging, setDragging] = useState(false);
  const [tabCtx, setTabCtx] = useState<{ x: number; y: number; index: number } | null>(null);
  const [listKey, setListKey] = useState(0);
  const [toasts, setToasts] = useState<{ id: string; chatId: string; project: string; title: string; body: string; warn?: boolean }[]>([]);
  const [usageKey, setUsageKey] = useState(0); // bumps after each finished reply to refresh usage
  const [sound, setSound] = useState(() => { try { return localStorage.getItem("vibecode.sound") !== "off"; } catch { return true; } });
  const toggleSound = () => setSound((v) => {
    try { localStorage.setItem("vibecode.sound", v ? "off" : "on"); } catch {}
    return !v;
  });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [defaultAccount, setDefaultAccount] = useState(() => { try { return localStorage.getItem("vibecode.account") ?? "default"; } catch { return "default"; } });
  const conn = useRef<ReturnType<typeof connect> | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // true while the view is pinned to the newest message
  const storeRef = useRef(store); storeRef.current = store;
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const projectRef = useRef(projectId); projectRef.current = projectId;
  const chatIdRef = useRef(chatId); chatIdRef.current = chatId;
  const accountsRef = useRef(accounts); accountsRef.current = accounts;
  const attachedRef = useRef(attached); attachedRef.current = attached;
  const soundRef = useRef(true);
  const [zoom, setZoom] = useState<string | null>(null); // image shown full-size in a popup
  useEffect(() => {
    if (!zoom) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [zoom]);
  const nameOfRef = useRef<(id?: string) => string>(() => "");
  const openChatRef = useRef<(id: string, project?: string) => Promise<void>>(async () => {});
  // Banner for the native Mac app (clicking it comes back through window.__vibecodeOpen).
  const nativeBanner = (title: string, body: string, chatId: string, project: string) =>
    (window as any).webkit?.messageHandlers?.notify?.postMessage({ title, body, subtitle: nameOfRef.current(project), chatId, project });
  useEffect(() => {
    (window as any).__vibecodeOpen = (chatId: string, project: string) => { openChatRef.current(chatId, project).catch(() => {}); };
    return () => { delete (window as any).__vibecodeOpen; };
  }, []);
  const saved = useRef(new Map<string, ChatState>());   // last persisted state per chat
  const lastTab = useRef<Record<string, string>>({});   // tab last viewed in each project

  const pending = attached[chatId] ?? [];
  soundRef.current = sound;
  const cur = store[chatId] ?? EMPTY;
  const { items, busy } = cur;
  const lastUser = items.reduce((n, it, i) => (it.kind === "user" ? i : n), -1); // the newest prompt stays pinned at the top
  const allPerms = items.filter((i): i is Extract<Item, { kind: "permission" }> => i.kind === "permission" && !i.answered);
  const pendingPerms = allPerms.filter((i) => i.tool !== "AskUserQuestion" && i.tool !== "ExitPlanMode");
  const plan = allPerms.find((i) => i.tool === "ExitPlanMode"); // plan approval docks like a question
  const ask = allPerms.find((i) => i.tool === "AskUserQuestion"); // questions from Claude open as a popup
  const [stopping, setStopping] = useState<Record<string, boolean>>({}); // Stop pressed, run not finished yet
  // Messages sent while Claude is still working wait here and go out one by one when the run ends.
  const [queue, setQueue] = useState<Record<string, { text: string; ids: string[] }[]>>({});
  const queueRef = useRef(queue); queueRef.current = queue;
  const dispatchRef = useRef<(id: string, text: string, ids: string[]) => void>(() => {});
  // Interrupt the current run; the first queued message goes out as soon as it has ended.
  const sendNow = () => { setStopping((x) => ({ ...x, [chatId]: true })); conn.current?.send({ type: "stop", chatId }); };
  const stopChat = () => { setQueue((q) => ({ ...q, [chatId]: [] })); queueRef.current = { ...queueRef.current, [chatId]: [] }; setStopping((x) => ({ ...x, [chatId]: true })); conn.current?.send({ type: "stop", chatId }); };
  // The account this session runs with (falls back to the default if it was removed).
  const accountId = accounts.some((a) => a.id === (cur.account ?? defaultAccount)) ? (cur.account ?? defaultAccount) : accounts[0]?.id ?? "default";
  const account = accounts.find((a) => a.id === accountId);

  const update = (s: Settings) => {
    setSettings(s);
    try { localStorage.setItem("vibecode.settings", JSON.stringify(s)); } catch {}
  };
  const patch = (id: string, fn: (c: ChatState) => ChatState) =>
    setStore((s) => ({ ...s, [id]: fn(s[id] ?? EMPTY) }));
  const push = (id: string, item: Item) => patch(id, (c) => ({ ...c, items: [...c.items, item.kind === "user" || item.kind === "text" ? { at: Date.now(), ...item } : item] }));

  // ---- tabs ----
  const activate = (id: string) => {
    const t = tabsRef.current.find((x) => x.id === id);
    setChatId(id);
    if (t) { lastTab.current[t.project] = id; if (t.project !== projectRef.current) onFocusProject(t.project); }
  };
  const addTab = (id: string, project: string, state: ChatState) => {
    setStore((s) => ({ ...s, [id]: state }));
    setTabs((t) => (t.some((x) => x.id === id) ? t : [...t, { id, project }]));
    lastTab.current[project] = id;
    setChatId(id);
    if (project !== projectRef.current) onFocusProject(project);
  };
  const newTab = (project = projectRef.current) =>
    addTab(crypto.randomUUID(), project, { items: [], busy: false, project, account: defaultAccount });
  const loadChat = async (id: string, project: string): Promise<ChatState> => {
    const c = await api<{ claudeSession?: string; items: Item[]; context?: Context; account?: string }>(`/api/chats/${id}`, { project });
    // Permission prompts from a past run can't be answered anymore.
    const state: ChatState = {
      items: c.items.map((i) => (i.kind === "permission" ? { ...i, answered: true } : i)),
      busy: false, claudeSession: c.claudeSession, context: c.context, project, account: c.account,
    };
    saved.current.set(id, state);
    return state;
  };
  // Open a saved session in its own tab (or jump to it if it's already open).
  const openChat = async (id: string, project = projectRef.current) => {
    if (tabsRef.current.some((t) => t.id === id)) return activate(id);
    addTab(id, project, await loadChat(id, project));
  };
  openChatRef.current = openChat;
  const closeMany = (ids: string[]) => {
    if (!ids.length) return;
    ids.forEach((id) => conn.current?.send({ type: "stop", chatId: id }));
    const all = tabsRef.current;
    setTabs(all.filter((t) => !ids.includes(t.id)));
    setStore((s) => { const n = { ...s }; ids.forEach((id) => delete n[id]); return n; });
    ids.forEach((id) => saved.current.delete(id));
    setDrafts((d) => { const n = { ...d }; ids.forEach((id) => delete n[id]); return n; });
    if (!ids.includes(chatIdRef.current)) return;
    // The tab on screen went away: move to the nearest survivor (right first), or start a fresh tab.
    const idx = all.findIndex((t) => t.id === chatIdRef.current);
    const next = all.slice(idx + 1).find((t) => !ids.includes(t.id)) ?? all.slice(0, idx).reverse().find((t) => !ids.includes(t.id));
    if (next) activate(next.id); else newTab();
  };
  const closeTab = (id: string) => closeMany([id]);

  // ---- startup: reopen the tabs from last time, then settle on the focused project ----
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !projects.length) return;
    restored.current = true;
    (async () => {
      let wanted: { tabs: Tab[]; active: string } = { tabs: [], active: "" };
      try { wanted = JSON.parse(localStorage.getItem(TABS_KEY) ?? "") ?? wanted; } catch {}
      const opened: Tab[] = [];
      for (const t of wanted.tabs ?? []) {
        if (!projects.some((p) => p.id === t.project)) continue;
        try { const st = await loadChat(t.id, t.project); setStore((s) => ({ ...s, [t.id]: st })); opened.push(t); } catch {}
      }
      setTabs(opened);
      for (const t of opened) lastTab.current[t.project] = t.id;
      if (opened.some((t) => t.id === wanted.active)) setChatId(wanted.active);
      setReady(true);
    })();
  }, [projects]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active: chatId })); } catch {}
  }, [tabs, chatId, ready]);

  // Focusing a project (explorer click) brings up one of its tabs: the one last viewed, any open one,
  // its newest saved session, or a fresh one.
  useEffect(() => {
    if (!ready || !projectId) return;
    if (storeRef.current[chatIdRef.current]?.project === projectId) return;
    const last = lastTab.current[projectId];
    const open = tabsRef.current.find((t) => t.id === last) ?? tabsRef.current.find((t) => t.project === projectId);
    if (open) { setChatId(open.id); return; }
    api<{ id: string }[]>("/api/chats", { project: projectId }).then((list) => {
      if (projectRef.current !== projectId) return;
      return list[0] ? openChat(list[0].id, projectId) : newTab(projectId);
    }).catch(() => newTab(projectId));
  }, [projectId, ready]);

  useEffect(() => {
    conn.current = connect((m) => {
      if (m.type === "socket-closed") {
        // Connection to the server dropped: its runs were stopped and nothing more will arrive, so unlock the chats.
        setStore((st) => Object.fromEntries(Object.entries(st).map(([id, c]) => [id, c.busy || c.items.some((i) => i.kind === "permission" && !i.answered)
          ? { ...c, busy: false, items: [...c.items.map((i) => (i.kind === "permission" ? { ...i, answered: true } : i)),
              ...(c.busy ? [{ kind: "error" as const, text: "Connection to the server was lost, so this reply was stopped. Send your message again." }] : [])] }
          : c])));
        setStopping({});
      }
      else if (m.type === "rejected") {
        push(m.chatId, { kind: "error", text: "Claude was still working on the previous message, so this one was not sent. Use the queue (Enter while it works) to send it afterwards." });
      }
      else if (m.type === "account-switched") {
        patch(m.chatId, (c) => ({ ...c, account: m.to }));
        push(m.chatId, { kind: "notice", text: `${m.fromName} hit its usage limit. Switched to ${m.toName} and carried on.` });
        setUsageKey((k) => k + 1);
        refreshAccounts();
      }
      else if (m.type === "context") patch(m.chatId, (c) => ({ ...c, context: { used: m.used, max: m.max } }));
      else if (m.type === "permission") {
        push(m.chatId, { kind: "permission", id: m.id, tool: m.tool, input: m.input });
        if (soundRef.current) {
          const tid = crypto.randomUUID();
          const what = m.tool === "ExitPlanMode" ? "Plan ready for review" : m.tool === "AskUserQuestion" ? String(m.input?.questions?.[0]?.question ?? "Claude has a question") : String(m.input?.command ?? m.input?.file_path ?? m.tool);
          setToasts((t) => [...t.slice(-2), { id: tid, chatId: m.chatId, project: storeRef.current[m.chatId]?.project ?? "", title: "Needs your approval", body: `${m.tool}: ${what}`.slice(0, 140), warn: true }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== tid)), 9000);
          nativeBanner("Needs your approval", `${m.tool}: ${what}`.slice(0, 140), m.chatId, storeRef.current[m.chatId]?.project ?? "");
        }
      }
      else if (m.type === "error") {
        push(m.chatId, { kind: "error", text: m.error });
        if (/not logged in|\/login/i.test(m.error)) refreshAccounts();
      }
      else if (m.type === "done") {
        patch(m.chatId, (c) => ({ ...c, busy: false }));
        const next = queueRef.current[m.chatId]?.[0];
        if (next) {
          setQueue((q) => ({ ...q, [m.chatId]: (q[m.chatId] ?? []).slice(1) }));
          queueRef.current = { ...queueRef.current, [m.chatId]: queueRef.current[m.chatId].slice(1) };
          setTimeout(() => dispatchRef.current(m.chatId, next.text, next.ids), 0);
        }
        setStopping((x) => { if (!x[m.chatId]) return x; const n = { ...x }; delete n[m.chatId]; return n; });
        setTimeout(() => setUsageKey((k) => k + 1), 1500);
        if (m.notify) {
          const id = crypto.randomUUID();
          setToasts((t) => [...t.slice(-2), { id, chatId: m.chatId, project: storeRef.current[m.chatId]?.project ?? "", ...m.notify }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
          nativeBanner(m.notify.title, m.notify.body, m.chatId, storeRef.current[m.chatId]?.project ?? "");
        }
      }
      else if (m.type === "sdk") {
        const msg = m.message;
        if (msg.session_id) patch(m.chatId, (c) => (c.claudeSession === msg.session_id ? c : { ...c, claudeSession: msg.session_id }));
        if (msg.type === "assistant") {
          for (const b of msg.message.content) {
            if (b.type === "text" && b.text.trim()) push(m.chatId, { kind: "text", text: b.text });
            else if (b.type === "tool_use") push(m.chatId, { kind: "tool", name: b.name, input: b.input });
          }
        }
      }
    });
    return () => { conn.current?.close(); };
  }, []);

  // Keep the newest message (and the loading animation) in view, unless the user scrolled up to read.
  const toBottom = () => { const el = msgsRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { stick.current = true; requestAnimationFrame(toBottom); }, [chatId]);
  useEffect(() => { if (stick.current) requestAnimationFrame(toBottom); }, [items, busy, pendingPerms.length]);
  // The viewport also shrinks when the approval dock or a thumbnail row appears: stay pinned through that too.
  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (stick.current) toBottom(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [chatId, projects.length, accountId]);

  // A closed folder takes its tabs (and running sessions) with it.
  useEffect(() => {
    if (!ready || !projects.length) return;
    for (const t of tabsRef.current) if (!projects.some((p) => p.id === t.project)) closeTab(t.id);
  }, [projects]);

  // Tell the explorer which projects have Claude working (or waiting for approval).
  useEffect(() => {
    const out: Record<string, "busy" | "waiting"> = {};
    for (const c of Object.values(store)) {
      if (!c.project) continue;
      if (c.items.some((i) => i.kind === "permission" && !i.answered)) out[c.project] = "waiting";
      else if (c.busy && out[c.project] !== "waiting") out[c.project] = "busy";
    }
    onStatus(out);
  }, [store]);

  // Persist every changed session (including background tabs) shortly after it changes.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      for (const [id, c] of Object.entries(store)) {
        const prev = saved.current.get(id);
        if (!c.project || !c.items.length || (prev && prev.items === c.items && prev.claudeSession === c.claudeSession && prev.context === c.context && prev.account === c.account)) continue;
        saved.current.set(id, c);
        api(`/api/chats/${id}`, { method: "PUT", body: { id, title: titleOf(c), claudeSession: c.claudeSession, context: c.context, account: c.account, items: c.items, updatedAt: Date.now() }, project: c.project })
          .then(() => setListKey((k) => k + 1)).catch(() => {});
      }
    }, 400);
    return () => clearTimeout(t);
  }, [store, ready]);

  // ---- image attachments (paste, drop or pick; several at once) ----
  const addFiles = async (files: File[]) => {
    const imgs = files.filter(isImage);
    if (!imgs.length) return;
    const id = chatIdRef.current;
    const room = MAX_ATTACHMENTS - (attachedRef.current[id]?.length ?? 0);
    const made: Attachment[] = [];
    for (const f of imgs.slice(0, Math.max(0, room))) { try { made.push(await toAttachment(f)); } catch {} }
    if (made.length) setAttached((a) => ({ ...a, [id]: [...(a[id] ?? []), ...made] }));
  };
  const removeAttachment = (key: string) => {
    setAttached((a) => ({ ...a, [chatId]: (a[chatId] ?? []).filter((x) => { if (x.key === key) URL.revokeObjectURL(x.preview); return x.key !== key; }) }));
  };

  // Start a run for this chat with an already-uploaded prompt.
  const dispatch = (id: string, text: string, ids: string[]) => {
    const c = storeRef.current[id];
    const project = c?.project ?? projectId;
    stick.current = true;
    patch(id, (x) => ({ ...x, busy: true, project, account: x.account ?? accountId }));
    push(id, { kind: "user", text, ...(ids.length ? { images: ids } : {}) });
    conn.current?.send({ type: "prompt", chatId: id, project, text, images: ids, opts: { ...settings, resume: c?.claudeSession, sound, autoSwitch: autoSwitchOn(), account: c?.account ?? accountId } });
  };
  dispatchRef.current = dispatch;
  const send = async () => {
    const text = input.trim();
    if (!text && !pending.length) return;
    const id = chatId, files = pending, wasBusy = busy;
    setInputFor(id, ""); setAttached((a) => ({ ...a, [id]: [] }));
    let ids: string[] = [];
    if (!wasBusy) patch(id, (c) => ({ ...c, busy: true, project: cur.project ?? projectId, account: accountId }));
    try { ids = await Promise.all(files.map((f) => uploadImage(f.blob))); }
    catch (e) { push(id, { kind: "error", text: String(e instanceof Error ? e.message : e) }); if (!wasBusy) patch(id, (c) => ({ ...c, busy: false })); return; }
    finally { files.forEach((f) => URL.revokeObjectURL(f.preview)); }
    // Still working (or became busy while uploading): queue it, like VS Code does.
    if (wasBusy) {
      setQueue((q) => ({ ...q, [id]: [...(q[id] ?? []), { text, ids }] }));
      return;
    }
    dispatch(id, text, ids);
  };
  // Prompt templates: send straight away (queued if Claude is busy), or drop the text into the message box.
  const sendText = (text: string) => {
    const id = chatId;
    if (busy) { setQueue((q) => ({ ...q, [id]: [...(q[id] ?? []), { text, ids: [] }] })); return; }
    patch(id, (c) => ({ ...c, busy: true, project: cur.project ?? projectId, account: accountId }));
    dispatch(id, text, []);
  };
  const insertText = (text: string) => {
    setInput(input.trim() ? input.replace(/\s+$/, "") + "\n\n" + text : text);
    requestAnimationFrame(() => { const el = taRef.current; if (!el) return; el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  };
  const answer = (id: string, allow: boolean, answers?: Record<string, string>, message?: string, mode?: string) => {
    conn.current?.send({ type: "permission", id, allow, answers, message, mode });
    patch(chatId, (c) => ({ ...c, items: c.items.map((x) => (x.kind === "permission" && x.id === id ? { ...x, answered: true } : x)) }));
  };
  const pickAccount = (id: string) => {
    patch(chatId, (c) => ({ ...c, account: id }));
    setDefaultAccount(id);
    try { localStorage.setItem("vibecode.account", id); } catch {}
  };

  // Per-session status for the history list: running, or waiting for an approval.
  const status: Record<string, "busy" | "waiting"> = {};
  for (const [id, c] of Object.entries(store)) {
    if (c.project !== projectId) continue;
    if (c.items.some((i) => i.kind === "permission" && !i.answered)) status[id] = "waiting";
    else if (c.busy) status[id] = "busy";
  }
  const projTint = (id: string) => projectTint(projects, id);
  const nameOf = (id?: string) => projects.find((p) => p.id === id)?.name ?? "";
  nameOfRef.current = nameOf;

  // This session's account isn't signed in: sign it in here, or pick another account.
  const needsLogin = !!account && !account.loggedIn;

  return (
    <div className="chat" style={width ? { width, flex: "none" } : undefined}>
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" onClick={(e) => e.stopPropagation()} />
          <button className="lb-x" title="Close (Esc)" onClick={() => setZoom(null)}><Icon name="x" size={18} /></button>
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => { setToasts((x) => x.filter((y) => y.id !== t.id)); if (t.project) openChat(t.chatId, t.project).catch(() => {}); }}>
            <span className={"t-ico" + (t.warn ? " warn" : "")}><Icon name={t.warn ? "hand" : "check"} size={14} /></span>
            <span className="t-txt"><b>{t.title}</b><small>{nameOf(t.project) ? `${nameOf(t.project)} · ` : ""}{t.body}</small></span>
          </div>
        ))}
      </div>
      <div className="chat-tabs">
        <div className="ctabs">
          {tabs.map((t) => {
            const c = store[t.id];
            const st = c?.items.some((i) => i.kind === "permission" && !i.answered) ? "waiting" : c?.busy ? "busy" : "";
            return (
              <div key={t.id} className={"ctab" + (t.id === chatId ? " on" : "")} onClick={() => activate(t.id)} title={`${nameOf(t.project)} · ${titleOf(c) || "New chat"}`}
                onContextMenu={(e) => { e.preventDefault(); setTabCtx({ x: e.clientX, y: e.clientY, index: tabs.findIndex((x) => x.id === t.id) }); }}>
                {st && <span className={"h-dot " + st} />}
                <span className="ct-title">{titleOf(c) || "New chat"}</span>
                {projects.length > 1 && <span className="ct-proj" style={projTint(t.project)}>{nameOf(t.project)}</span>}
                <span className="x" title="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><Icon name="x" size={12} /></span>
              </div>
            );
          })}
        </div>
        <button className="g-icon tbtn" style={{ visibility: "visible" }} title="New chat tab" onClick={() => newTab()}><Icon name="plus" size={16} /></button>
        <ChatHistory project={projectId} projectName={nameOf(projectId)} currentId={chatId} refreshKey={listKey} status={status}
          onOpen={(id) => openChat(id).catch(() => {})}
          onDeleted={(id) => { if (tabsRef.current.some((t) => t.id === id)) closeTab(id); }} />
        <button className="g-icon tbtn" style={{ visibility: "visible" }} title="Settings" onClick={openSettings}><Icon name="settings" size={16} /></button>
      </div>
      {tabCtx && <ContextMenu x={tabCtx.x} y={tabCtx.y} onClose={() => setTabCtx(null)} items={tabMenu(tabs.map((t) => t.id), tabCtx.index, closeMany)} />}
      {!projects.length ? (
        <div className="login-wrap"><div className="empty-hint">Add a folder in the explorer to start chatting with Claude about it.</div></div>
      ) : needsLogin ? (
        <div className="login-wrap">
          <LoginFlow account={accountId} onDone={refreshAccounts} onChanged={refreshAccounts} />
          <div className="login-alt">
            <span className="muted">Signing in as</span>
            <AccountMenu accounts={accounts} value={accountId} onChange={pickAccount} onManage={openSettings} />
          </div>
        </div>
      ) : (<>
      <div className="messages" ref={msgsRef}
        onClick={(e) => { // any picture inside the conversation (sent attachments, markdown images) opens in the popup
          const img = (e.target as HTMLElement).closest?.("img.zoomable, .msg-imgs img, .md img") as HTMLImageElement | null;
          if (img?.src && !img.classList.contains("loading")) { e.preventDefault(); setZoom(img.src); }
        }}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {items.map((it, i) => {
          if (it.kind === "tool") {
            return <ToolItem key={i} name={it.name} input={it.input} />;
          }
          if (it.kind === "permission") return null; // pending ones sit in the dock above the usage bar
          if (it.kind === "text") return <div key={i} className="msg text"><Markdown text={it.text} /><MsgMeta text={it.text} at={it.at} /></div>;
          if (it.kind === "user") return <UserMessage key={i} text={it.text} at={it.at} images={it.images} pinned={i === lastUser} />;
          return <div key={i} className={`msg ${it.kind}`}>{it.text}</div>;
        })}
        {busy && <Working onShow={() => stick.current && toBottom()} />}
        <div ref={end} />
      </div>
      {pendingPerms.length > 0 && (
        <div className="perm-dock">
          {pendingPerms.map((it) => (
            <div key={it.id} className="perm">
              {it.tool === "ExitPlanMode"
                ? <><b>Plan</b><pre className="plan">{it.input?.plan}</pre>Approve this plan?</>
                : <>Allow <b>{it.tool}</b>? <code>{brief(it.input)}</code></>}
              <div className="perm-actions">
                <button onClick={() => answer(it.id, true)}>Allow</button>
                <button onClick={() => answer(it.id, false)}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {plan && <PlanDock key={plan.id} plan={String(plan.input?.plan ?? "")} onApprove={(autoEdit) => { if (autoEdit) update({ ...settings, mode: "edit" }); answer(plan.id, true, undefined, undefined, autoEdit ? "edit" : undefined); }} onRevise={(note) => answer(plan.id, false, undefined, "The user wants the plan revised. Do not implement yet; update the plan and present it again." + (note ? `\nUser notes: ${note}` : ""))} />}
      {ask && <AskDock key={ask.id} input={ask.input} onSubmit={(answers) => answer(ask.id, true, answers)} onCancel={() => answer(ask.id, false)} />}
      <UsageBar refreshKey={usageKey} context={cur.context} account={accountId} />
      <div className={"composer" + (dragging ? " drag" : "")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles([...e.dataTransfer.files]); }}>
        {pending.length > 0 && (
          <div className="attach-row">
            {pending.map((a) => (
              <div key={a.key} className="thumb" title={a.name}>
                <img className="zoomable" src={a.preview} alt={a.name} onClick={() => setZoom(a.preview)} />
                <button className="thumb-x" onClick={() => removeAttachment(a.key)} title="Remove"><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>
        )}
        {(queue[chatId]?.length ?? 0) > 0 && (
          <div className="queue">
            {queue[chatId].map((q, i) => (
              <div key={i} className="q-item" title={q.text}>
                <span className="q-tag">Queued</span><span className="q-txt">{q.text || "(image)"}</span>
                {i === 0 && busy && <button className="q-now" title="Send now (Enter): interrupts the current reply" onClick={sendNow}><Icon name="send" size={11} /></button>}
                <button title="Remove" onClick={() => setQueue((x) => ({ ...x, [chatId]: x[chatId].filter((_, j) => j !== i) }))}><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef} rows={1} spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off"
          value={input} placeholder="Ask Claude…  (Enter to send, paste images)"
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter(isImage);
            if (files.length) { e.preventDefault(); addFiles(files); } // plain-text pastes go through untouched
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); update({ ...settings, mode: nextMode(settings.mode) }); return; }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // Enter on an empty box while messages are queued: stop waiting and send the next one now.
              if (busy && !input.trim() && !pending.length && (queue[chatId]?.length ?? 0) > 0) sendNow(); else send();
            } }}
        />
        <div className="composer-bar">
        <ModeMenu value={settings} onChange={update} />
        <ModelMenu account={accountId} value={settings.model} onChange={(model) => update({ ...settings, model })} />
        <AccountMenu accounts={accounts} value={accountId} onChange={pickAccount} onManage={openSettings} />
        <TemplateMenu onSend={sendText} onToChat={insertText} onRun={onRunInTerminal} />
        {project && <RemotePanel project={project} accounts={accounts} account={accountId} mode={settings.mode} state={remote} />}
        <button className="modebtn soundbtn" title={sound ? "Sound & notification on" : "Sound & notification off"} onClick={toggleSound}><Icon name={sound ? "bell" : "bellOff"} size={15} /></button>
        <span className="spacer" />
        {busy
          ? (input.trim() || pending.length) && !stopping[chatId]
            ? <button className="sendbtn" title="Queue message (sent when Claude finishes)" onClick={send}><Icon name="send" size={16} /></button>
            : stopping[chatId]
              ? <button className="sendbtn stop stopping" title="Stopping…" disabled><span className="spin" /></button>
              : <button className="sendbtn stop" title="Stop" onClick={stopChat}><Icon name="stop" size={14} /></button>
          : <button className="sendbtn" title="Send" disabled={!input.trim() && !pending.length} onClick={send}><Icon name="send" size={16} /></button>}
        </div>
      </div>
      </>)}
    </div>
  );
}

// Claude's AskUserQuestion, docked above the usage meters (the rest of the UI stays usable).
// With several questions they appear one at a time; picking an option on a single-choice question moves on.
function AskDock({ input, onSubmit, onCancel }: { input: any; onSubmit: (a: Record<string, string>) => void; onCancel: () => void }) {
  const qs: { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }[] = input?.questions ?? [];
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Record<string, string>>({});
  const [multi, setMulti] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const q = qs[step];
  if (!q) return null;
  const advance = (value: string) => {
    const next = { ...done, [q.question]: value };
    if (step + 1 >= qs.length) return onSubmit(next);
    setDone(next); setStep(step + 1); setMulti([]); setOther("");
  };
  const custom = other.trim();
  return (
    <div className="ask-dock">
      <div className="ask-head">
        <span className="ask-title">{q.header ? <em>{q.header}</em> : null}{q.question}</span>
        {qs.length > 1 && <span className="ask-step">{step + 1}/{qs.length}</span>}
        <button className="ask-skip" title="Skip" onClick={onCancel}><Icon name="x" size={12} /></button>
      </div>
      <div className="ask-opts">
        {q.options.map((o) => {
          const on = multi.includes(o.label);
          return (
            <button key={o.label} className={"ask-opt" + (on ? " on" : "")} title={o.description}
              onClick={() => q.multiSelect ? setMulti(on ? multi.filter((x) => x !== o.label) : [...multi, o.label]) : advance(o.label)}>
              <b>{o.label}</b>{o.description && <small>{o.description}</small>}
            </button>
          );
        })}
      </div>
      <div className="ask-foot">
        <input placeholder="Other…" value={other} onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (custom || multi.length)) advance([...multi, ...(custom ? [custom] : [])].join(", ")); }} />
        {(q.multiSelect || custom) && (
          <button className="primary" disabled={!multi.length && !custom}
            onClick={() => advance([...multi, ...(custom ? [custom] : [])].join(", "))}>{step + 1 >= qs.length ? "Send" : "Next"}</button>
        )}
      </div>
    </div>
  );
}

// Plan approval: read the plan, then start work, or keep planning with a note for Claude.
function PlanDock({ plan, onApprove, onRevise }: { plan: string; onApprove: (autoEdit: boolean) => void; onRevise: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="ask-dock plan-dock">
      <div className="ask-head"><span className="ask-title">Plan ready. Start working on it?</span></div>
      <div className="plan-body"><Markdown text={plan} /></div>
      <div className="ask-opts">
        <button className="ask-opt" onClick={() => onApprove(true)}><b>Yes, and auto-edit</b><small>Start working; edit files without asking for the rest of the session</small></button>
        <button className="ask-opt" onClick={() => onApprove(false)}><b>Yes, ask before each edit</b><small>Start working; keep approving every edit manually</small></button>
      </div>
      <div className="ask-foot">
        <input placeholder="No, keep planning: tell Claude what to change…" value={note} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onRevise(note.trim()); }} />
        <button className="primary" onClick={() => onRevise(note.trim())}>{note.trim() ? "Revise" : "Keep planning"}</button>
      </div>
    </div>
  );
}

// "Claude is working" indicator: shimmering text that cycles through a few phrases, with bouncing dots.
const PHRASES = ["wait, cooking", "dev by rinoaprisedo.com", "rinoaprisedo typing", "thinking it through", "rinoaprisedo read files", "reading the code", "dev by rinoaprisedo.com", "rinoaprisedo found problem", "almost there", "still cooking"];
function Working({ onShow }: { onShow: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => { onShow(); const t = setInterval(() => setN((x) => (x + 1) % PHRASES.length), 4500); return () => clearInterval(t); }, []);
  return (
    <div className="working" role="status" aria-label="Claude is working">
      <span className="w-spark"><Icon name="sparkle" size={13} /></span>
      <span key={n} className="w-text">{PHRASES[n]}</span>
      <span className="w-dots"><i /><i /><i /></span>
    </div>
  );
}

// Small footer under a bubble: time it was sent and a copy button.
function MsgMeta({ text, at }: { text: string; at?: number }) {
  const [done, setDone] = useState(false);
  const copy = (e: ReactMouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {});
  };
  const time = at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="msg-meta">
      {time && <span className="mm-time" title={new Date(at!).toLocaleString()}>{time}</span>}
      <button className="mm-copy" title={done ? "Copied" : "Copy"} onClick={copy}><Icon name={done ? "check" : "copy"} size={12} /></button>
    </div>
  );
}

// A submitted prompt. Long ones are clamped (click to expand). The newest one is pinned to the top of the chat,
// so after a long reply you can still see what you asked.
function UserMessage({ text, images, pinned, at }: { text: string; images?: string[]; pinned: boolean; at?: number }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && !open) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, open, pinned]);
  return (
    <div className={"msg user" + (pinned ? " pin" : "") + (open ? " open" : "")}>
      {images && <div className="msg-imgs">{images.map((id) => <a key={id} href={imageUrl(id)} target="_blank" rel="noreferrer"><img src={imageUrl(id)} alt="attachment" /></a>)}</div>}
      <div className="u-text" ref={box}>{text}</div>
      <MsgMeta text={text} at={at} />
      {(clamped || open) && <button className="u-more" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button>}
    </div>
  );
}

// A tool call: one-line chip (with Claude's own description of the step when it gave one); click to see everything.
function ToolItem({ name, input }: { name: string; input: any }) {
  const [open, setOpen] = useState(false);
  const t = toolView(name, input);
  const why: string = name === "Bash" || name === "Task" || name === "Agent" ? input?.description ?? "" : "";
  const lines = (txt: string, cls: string) => String(txt ?? "").split("\n").map((l, i) => <div key={i} className={cls}>{(cls === "d-add" ? "+ " : cls === "d-del" ? "- " : "  ") + l}</div>);
  const edits: { old_string?: string; new_string?: string }[] = name === "Edit" ? [input] : name === "MultiEdit" ? input?.edits ?? [] : [];
  let body: ReactNode;
  if (edits.length) body = <>{input?.file_path && <div className="tool-path">{input.file_path}</div>}{edits.map((e, i) => <div key={i} className="tool-diff">{lines(e.old_string ?? "", "d-del")}{lines(e.new_string ?? "", "d-add")}</div>)}</>;
  else if (name === "Write") body = <>{<div className="tool-path">{input?.file_path}</div>}<div className="tool-diff">{lines(String(input?.content ?? "").slice(0, 4000), "d-add")}</div></>;
  else if (name === "Bash") body = <>{why && <div className="tool-why">{why}</div>}<pre className="tool-pre">{input?.command}</pre></>;
  else body = <pre className="tool-pre">{JSON.stringify(input, null, 2)}</pre>;
  return (
    <div className={"tool-wrap" + (open ? " open" : "")}>
      <div className={"tool t-" + t.tone} onClick={() => setOpen(!open)} title={open ? "Hide details" : "Show details"}>
        <Icon name={t.icon} size={12} /><b>{name}</b><span>{t.detail}</span>
        {why && !open && <em className="tool-note">{why}</em>}
        <Icon name={open ? "chevronDown" : "chevronRight"} size={11} />
      </div>
      {open && <div className="tool-body">{body}</div>}
    </div>
  );
}

// Icon + short, human-readable target for each kind of tool call.
function toolView(name: string, input: any): { icon: IconName; tone: string; detail: string } {
  const short = (p?: string) => (p ? p.split("/").slice(-2).join("/") : "");
  switch (name) {
    case "Read": return { icon: "file", tone: "read", detail: short(input?.file_path) };
    case "Edit": case "MultiEdit": case "NotebookEdit": return { icon: "pencil", tone: "edit", detail: short(input?.file_path ?? input?.notebook_path) };
    case "Write": return { icon: "pencil", tone: "edit", detail: short(input?.file_path) };
    case "Bash": return { icon: "terminal", tone: "run", detail: input?.command ?? "" };
    case "Grep": case "Glob": return { icon: "search", tone: "read", detail: input?.pattern ?? "" };
    case "WebFetch": case "WebSearch": return { icon: "globe", tone: "read", detail: input?.url ?? input?.query ?? "" };
    case "TodoWrite": return { icon: "plan", tone: "read", detail: "" };
    default: return { icon: "sparkle", tone: "read", detail: input?.description ?? input?.prompt ?? "" };
  }
}

const brief = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
};
