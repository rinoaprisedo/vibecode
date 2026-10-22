import { useEffect, useRef, useState } from "react";
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
import { Icon, type IconName } from "./Icon";
import { Markdown } from "./Markdown";

const loadSettings = (): Settings => {
  try { return { mode: "manual", effort: "medium", ultracode: false, model: "", ...JSON.parse(localStorage.getItem("vibecode.settings") ?? "{}") }; }
  catch { return { mode: "manual", effort: "medium", ultracode: false, model: "" }; }
};

type Item =
  | { kind: "user" | "text" | "error"; text: string; images?: string[] }
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
};
type Tab = { id: string; project: string };

const TABS_KEY = "vibecode.chatTabs";

export function ChatPanel({ projects, projectId, onFocusProject, onStatus, accounts, refreshAccounts, openSettings, project, remote, width }: Props) {
  // Every open chat tab keeps its own state and keeps running in the background.
  const [store, setStore] = useState<Record<string, ChatState>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [chatId, setChatId] = useState("");
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
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
  const storeRef = useRef(store); storeRef.current = store;
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const projectRef = useRef(projectId); projectRef.current = projectId;
  const chatIdRef = useRef(chatId); chatIdRef.current = chatId;
  const accountsRef = useRef(accounts); accountsRef.current = accounts;
  const attachedRef = useRef(attached); attachedRef.current = attached;
  const soundRef = useRef(true);
  const saved = useRef(new Map<string, ChatState>());   // last persisted state per chat
  const lastTab = useRef<Record<string, string>>({});   // tab last viewed in each project

  const pending = attached[chatId] ?? [];
  soundRef.current = sound;
  const cur = store[chatId] ?? EMPTY;
  const { items, busy } = cur;
  // The account this session runs with (falls back to the default if it was removed).
  const accountId = accounts.some((a) => a.id === (cur.account ?? defaultAccount)) ? (cur.account ?? defaultAccount) : accounts[0]?.id ?? "default";
  const account = accounts.find((a) => a.id === accountId);

  const update = (s: Settings) => {
    setSettings(s);
    try { localStorage.setItem("vibecode.settings", JSON.stringify(s)); } catch {}
  };
  const patch = (id: string, fn: (c: ChatState) => ChatState) =>
    setStore((s) => ({ ...s, [id]: fn(s[id] ?? EMPTY) }));
  const push = (id: string, item: Item) => patch(id, (c) => ({ ...c, items: [...c.items, item] }));

  // ---- tabs ----
  const activate = (id: string) => {
    const t = tabsRef.current.find((x) => x.id === id);
    setChatId(id); setInput("");
    if (t) { lastTab.current[t.project] = id; if (t.project !== projectRef.current) onFocusProject(t.project); }
  };
  const addTab = (id: string, project: string, state: ChatState) => {
    setStore((s) => ({ ...s, [id]: state }));
    setTabs((t) => (t.some((x) => x.id === id) ? t : [...t, { id, project }]));
    lastTab.current[project] = id;
    setChatId(id); setInput("");
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
  const closeMany = (ids: string[]) => {
    if (!ids.length) return;
    ids.forEach((id) => conn.current?.send({ type: "stop", chatId: id }));
    const all = tabsRef.current;
    setTabs(all.filter((t) => !ids.includes(t.id)));
    setStore((s) => { const n = { ...s }; ids.forEach((id) => delete n[id]); return n; });
    ids.forEach((id) => saved.current.delete(id));
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
    if (open) { setChatId(open.id); setInput(""); return; }
    api<{ id: string }[]>("/api/chats", { project: projectId }).then((list) => {
      if (projectRef.current !== projectId) return;
      return list[0] ? openChat(list[0].id, projectId) : newTab(projectId);
    }).catch(() => newTab(projectId));
  }, [projectId, ready]);

  useEffect(() => {
    conn.current = connect((m) => {
      if (m.type === "context") patch(m.chatId, (c) => ({ ...c, context: { used: m.used, max: m.max } }));
      else if (m.type === "permission") {
        push(m.chatId, { kind: "permission", id: m.id, tool: m.tool, input: m.input });
        if (soundRef.current) {
          const tid = crypto.randomUUID();
          const what = m.tool === "ExitPlanMode" ? "Plan ready for review" : String(m.input?.command ?? m.input?.file_path ?? m.tool);
          setToasts((t) => [...t.slice(-2), { id: tid, chatId: m.chatId, project: storeRef.current[m.chatId]?.project ?? "", title: "Needs your approval", body: `${m.tool}: ${what}`.slice(0, 140), warn: true }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== tid)), 9000);
        }
      }
      else if (m.type === "error") {
        push(m.chatId, { kind: "error", text: m.error });
        if (/not logged in|\/login/i.test(m.error)) refreshAccounts();
      }
      else if (m.type === "done") {
        patch(m.chatId, (c) => ({ ...c, busy: false }));
        setTimeout(() => setUsageKey((k) => k + 1), 1500);
        if (m.notify) {
          const id = crypto.randomUUID();
          setToasts((t) => [...t.slice(-2), { id, chatId: m.chatId, project: storeRef.current[m.chatId]?.project ?? "", ...m.notify }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
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

  useEffect(() => { end.current?.scrollIntoView(); }, [items, busy, chatId]);

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

  const send = async () => {
    const text = input.trim();
    if ((!text && !pending.length) || busy) return;
    const id = chatId, project = cur.project ?? projectId, files = pending;
    patch(id, (c) => ({ ...c, busy: true, project, account: accountId }));
    setInput(""); setAttached((a) => ({ ...a, [id]: [] }));
    let ids: string[] = [];
    try { ids = await Promise.all(files.map((f) => uploadImage(f.blob))); }
    catch (e) { push(id, { kind: "error", text: String(e instanceof Error ? e.message : e) }); patch(id, (c) => ({ ...c, busy: false })); return; }
    finally { files.forEach((f) => URL.revokeObjectURL(f.preview)); }
    push(id, { kind: "user", text, ...(ids.length ? { images: ids } : {}) });
    conn.current?.send({ type: "prompt", chatId: id, project, text, images: ids, opts: { ...settings, resume: cur.claudeSession, sound, account: accountId } });
  };
  const answer = (id: string, allow: boolean) => {
    conn.current?.send({ type: "permission", id, allow });
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
  const pendingPerms = items.filter((i): i is Extract<Item, { kind: "permission" }> => i.kind === "permission" && !i.answered);
  const nameOf = (id?: string) => projects.find((p) => p.id === id)?.name ?? "";

  // This session's account isn't signed in: sign it in here, or pick another account.
  const needsLogin = !!account && !account.loggedIn;

  return (
    <div className="chat" style={width ? { width, flex: "none" } : undefined}>
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
                {projects.length > 1 && <span className="ct-proj">{nameOf(t.project)}</span>}
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
          <LoginFlow account={accountId} onDone={refreshAccounts} />
          <div className="login-alt">
            <span className="muted">Signing in as</span>
            <AccountMenu accounts={accounts} value={accountId} onChange={pickAccount} onManage={openSettings} />
          </div>
        </div>
      ) : (<>
      <div className="messages">
        {items.map((it, i) => {
          if (it.kind === "tool") {
            const t = toolView(it.name, it.input);
            return <div key={i} className={"tool t-" + t.tone} title={brief(it.input)}><Icon name={t.icon} size={12} /><b>{it.name}</b><span>{t.detail}</span></div>;
          }
          if (it.kind === "permission") return null; // pending ones sit in the dock above the usage bar
          if (it.kind === "text") return <div key={i} className="msg text"><Markdown text={it.text} /></div>;
          if (it.kind === "user") return (
            <div key={i} className="msg user">
              {it.images && <div className="msg-imgs">{it.images.map((id) => <a key={id} href={imageUrl(id)} target="_blank" rel="noreferrer"><img src={imageUrl(id)} alt="attachment" /></a>)}</div>}
              {it.text}
            </div>
          );
          return <div key={i} className={`msg ${it.kind}`}>{it.text}</div>;
        })}
        {busy && <img className="loading" src="/loading.gif?v=2" alt="Claude is working…" />}
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
      <UsageBar refreshKey={usageKey} context={cur.context} account={accountId} />
      <div className={"composer" + (dragging ? " drag" : "")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles([...e.dataTransfer.files]); }}>
        {pending.length > 0 && (
          <div className="attach-row">
            {pending.map((a) => (
              <div key={a.key} className="thumb" title={a.name}>
                <img src={a.preview} alt={a.name} />
                <button className="thumb-x" onClick={() => removeAttachment(a.key)} title="Remove"><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={input} placeholder="Ask Claude…  (Enter to send, paste images)"
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter(isImage);
            if (files.length) { e.preventDefault(); addFiles(files); } // plain-text pastes go through untouched
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); update({ ...settings, mode: nextMode(settings.mode) }); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <div className="composer-bar">
        <ModeMenu value={settings} onChange={update} />
        <ModelMenu account={accountId} value={settings.model} onChange={(model) => update({ ...settings, model })} />
        <AccountMenu accounts={accounts} value={accountId} onChange={pickAccount} onManage={openSettings} />
        {project && <RemotePanel project={project} accounts={accounts} state={remote} />}
        <button className="modebtn soundbtn" title={sound ? "Sound & notification on" : "Sound & notification off"} onClick={toggleSound}><Icon name={sound ? "bell" : "bellOff"} size={15} /></button>
        <span className="spacer" />
        {busy
          ? <button className="sendbtn stop" title="Stop" onClick={() => conn.current?.send({ type: "stop", chatId })}><Icon name="stop" size={14} /></button>
          : <button className="sendbtn" title="Send" disabled={!input.trim() && !pending.length} onClick={send}><Icon name="send" size={16} /></button>}
        </div>
      </div>
      </>)}
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
