import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

export type FixKind = "identity" | "auth" | "remote";

// Which kind of "you need to set something up" a git error message is, or null for an ordinary error.
export const classifyGitError = (text: string): FixKind | null => {
  if (/author identity unknown|unable to auto-detect email|please tell me who you are|empty ident name|no email was given/i.test(text)) return "identity";
  if (/no configured push destination|no such remote|no remote repository|does not appear to be a git repository|no remote/i.test(text)) return "remote";
  if (/could not read (username|password)|terminal prompts disabled|authentication failed|invalid username or password|permission denied|publickey|host key verification|could not read from remote repository|repository not found|returned error: 40[13]|password authentication was removed|access denied/i.test(text)) return "auth";
  return null;
};

type Info = {
  name: string; email: string; helper: string; storage: string; platform: string;
  remote: { name: string; url: string; kind: "https" | "ssh" | "other"; host: string } | null;
  ssh: { has: boolean; name: string; publicKey: string };
};

// Where each popular host keeps its token and key settings.
const HOSTS: Record<string, { name: string; token: string; key: string; tokenHint: string }> = {
  "github.com": { name: "GitHub", token: "https://github.com/settings/tokens/new?scopes=repo&description=Vibecoder", key: "https://github.com/settings/ssh/new", tokenHint: "Tick the “repo” permission." },
  "gitlab.com": { name: "GitLab", token: "https://gitlab.com/-/user_settings/personal_access_tokens", key: "https://gitlab.com/-/user_settings/ssh_keys", tokenHint: "Tick “write_repository”." },
  "bitbucket.org": { name: "Bitbucket", token: "https://bitbucket.org/account/settings/app-passwords/", key: "https://bitbucket.org/account/settings/ssh-keys/", tokenHint: "Give it repository read and write." },
};

const TITLE: Record<FixKind, string> = {
  identity: "Git needs to know who you are",
  auth: "Sign in to push",
  remote: "No remote repository yet",
};

// Replaces the raw git error with an explanation and a small form that fixes the problem; `onFixed` retries what failed.
export function GitFix({ kind, raw, project, retryLabel, onFixed, onClose }: {
  kind: FixKind; raw: string; project: string; retryLabel: string; onFixed: () => void; onClose: () => void;
}) {
  const call = <T = any,>(path: string, body?: unknown) => api<T>(path, { body, project });
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [okText, setOkText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [global, setGlobal] = useState(true);
  const [user, setUser] = useState("");
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    let alive = true;
    api<Info>("/api/git/identity", { project }).then((i) => { if (!alive) return; setInfo(i); setName(i.name); setEmail(i.email); }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [project]);

  const step = async (label: string, fn: () => Promise<unknown>, then?: () => void) => {
    setBusy(label); setErr(""); setOkText("");
    try { await fn(); then?.(); } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  const remote = info?.remote;
  const host = remote ? HOSTS[remote.host] : undefined;
  const hostName = host?.name ?? (remote?.host || "the server");
  const ssh = remote && remote.kind !== "https";                 // https remotes want a token; ssh (or odd) ones want a key
  const reload = () => api<Info>("/api/git/identity", { project }).then(setInfo).catch(() => {});

  const saveIdentity = () => step("identity", () => call("/api/git/identity", { name, email, global }), onFixed);
  const saveToken = () => step("token", async () => {
    await call("/api/git/credentials", { username: user, token });
    await call("/api/git/test", {}).catch((e) => { throw new Error("Saved, but the server still refused it: " + e.message); });
  }, onFixed);
  const makeKey = () => step("key", async () => { await call("/api/git/ssh-key", {}); await reload(); });
  const testKey = () => step("test", async () => { await call("/api/git/test", {}); setOkText("Connected"); }, onFixed);
  const saveRemote = () => step("remote", () => call("/api/git/remote", { url }), onFixed);
  const copyKey = () => navigator.clipboard?.writeText(info?.ssh.publicKey ?? "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });

  return (
    <div className="gfix">
      <div className="gfix-head">
        <span className="gfix-ico"><Icon name={kind === "identity" ? "user" : kind === "remote" ? "branch" : "settings"} size={14} /></span>
        <b>{TITLE[kind]}</b>
        <button className="g-icon" style={{ visibility: "visible" }} title="Dismiss" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>

      {!info && !err && <div className="muted">Checking your setup…</div>}

      {info && kind === "identity" && (
        <>
          <p>Every commit records a name and email. Git has none set up on this computer yet. Fill them in once and your commit goes through.</p>
          <label>Name<input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Email<input placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="gfix-check"><input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} /> Use for all my projects <small>(saved in your global git settings)</small></label>
          <button className="primary" disabled={!!busy || !name.trim() || !email.includes("@")} onClick={saveIdentity}>{busy ? "Saving…" : `Save & ${retryLabel}`}</button>
        </>
      )}

      {info && kind === "auth" && !ssh && (
        <>
          <p><b>{hostName}</b> doesn't accept a password for git. Sign in once with an <b>access token</b>; it is saved in {info.storage}, never in the project.</p>
          <ol className="gfix-steps">
            <li>
              {host ? <a className="gfix-link" href={host.token} target="_blank" rel="noreferrer">Create a token on {host.name} <Icon name="external" size={11} /></a> : <>Create an access token in your {hostName} account settings.</>}
              {host && <small>{host.tokenHint}</small>}
            </li>
            <li>Paste it here with your username:</li>
          </ol>
          <label>Username<input placeholder={`${hostName} username`} value={user} autoCapitalize="off" onChange={(e) => setUser(e.target.value)} /></label>
          <label>Token<input type="password" placeholder="Paste the token" value={token} onChange={(e) => setToken(e.target.value)} /></label>
          <button className="primary" disabled={!!busy || !user.trim() || !token.trim()} onClick={saveToken}>{busy ? "Checking…" : `Save & ${retryLabel}`}</button>
        </>
      )}

      {info && kind === "auth" && ssh && (
        <>
          <p>This repository uses an <b>SSH</b> address, so {hostName} needs to know your computer's key. {info.ssh.has ? "Add the key below to your account, then test." : "You don't have an SSH key yet. Create one, then add it to your account."}</p>
          {!info.ssh.has
            ? <button className="primary" disabled={!!busy} onClick={makeKey}>{busy === "key" ? "Creating…" : <><Icon name="plus" size={13} /> Create SSH key</>}</button>
            : (
              <>
                <div className="gfix-key" title={info.ssh.name}>{info.ssh.publicKey}</div>
                <div className="gfix-row">
                  <button onClick={copyKey}><Icon name="copy" size={12} /> {copied ? "Copied" : "Copy key"}</button>
                  {host && <a className="gfix-link btn" href={host.key} target="_blank" rel="noreferrer">Add it on {host.name} <Icon name="external" size={11} /></a>}
                </div>
                <button className="primary" disabled={!!busy} onClick={testKey}>{busy ? "Testing…" : `Test connection & ${retryLabel}`}</button>
              </>
            )}
        </>
      )}

      {info && kind === "remote" && (
        <>
          <p>This project isn't connected to a repository on {remote ? "the server" : "GitHub or GitLab"} yet. Create an <b>empty</b> repository there, then paste its address:</p>
          <label>Repository URL<input placeholder="https://github.com/you/project.git" value={url} autoCapitalize="off" onChange={(e) => setUrl(e.target.value)} /></label>
          <button className="primary" disabled={!!busy || !url.trim()} onClick={saveRemote}>{busy ? "Saving…" : `Connect & ${retryLabel}`}</button>
        </>
      )}

      {err && <div className="gfix-err">{err}</div>}
      {okText && <div className="gfix-ok">{okText}</div>}
      <button className="gfix-raw" onClick={() => setShowRaw(!showRaw)}><Icon name={showRaw ? "chevronDown" : "chevronRight"} size={12} /> What git said</button>
      {showRaw && <pre className="gfix-rawtext">{raw}</pre>}
    </div>
  );
}
