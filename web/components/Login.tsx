import { useState } from "react";
import { Icon } from "./Icon";

export type LoginState = { step: "choose" } | { step: "waiting"; mode: string; url?: string } | { step: "failed" };

// Mirrors the VS Code extension's sign-in screen: pick an account type, open browser, paste code.
export function Login({ state, onStart, onCode, onCancel }: {
  state: LoginState;
  onStart: (mode: "claudeai" | "console") => void;
  onCode: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");

  if (state.step === "waiting") {
    return (
      <div className="login">
        <div className="logo"><Icon name="sparkle" size={24} /></div>
        <h2>Sign in to Claude</h2>
        {state.url ? (
          <>
            <p className="muted">Browser should have opened. If not, open this link:</p>
            <a href={state.url} target="_blank" rel="noreferrer">Open sign-in page</a>
            <p className="muted">After signing in, paste the code shown on the page:</p>
            <input autoFocus placeholder="Paste code here" value={code} onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && code && onCode(code)} />
            <button className="primary" disabled={!code} onClick={() => onCode(code)}>Continue</button>
          </>
        ) : <p className="muted">Preparing sign-in…</p>}
        <button onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="logo"><Icon name="sparkle" size={24} /></div>
        <h2>Sign in to Claude</h2>
      {state.step === "failed" && <div className="err">Sign-in failed. Try again.</div>}
      <p className="muted">Choose how you want to sign in:</p>
      <button className="primary" onClick={() => onStart("claudeai")}>
        Claude account with subscription
        <small>Pro, Max, Team, or Enterprise</small>
      </button>
      <button onClick={() => onStart("console")}>
        Anthropic Console account
        <small>API usage billing</small>
      </button>
    </div>
  );
}
