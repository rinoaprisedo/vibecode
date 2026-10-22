import { useEffect, useRef, useState } from "react";
import { connect } from "../lib/api";
import { Login, type LoginState } from "./Login";

// Sign-in for one specific Claude account: pick type, open browser, paste the code.
export function LoginFlow({ account, onDone, onChanged }: { account: string; onDone: () => void; onChanged?: () => void }) {
  const [state, setState] = useState<LoginState>({ step: "choose" });
  const conn = useRef<ReturnType<typeof connect> | undefined>(undefined);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  useEffect(() => {
    conn.current = connect((m) => {
      if (m.account !== account) return;
      if (m.type === "login-url") setState((l) => (l.step === "waiting" ? { ...l, url: m.url } : l));
      else if (m.type === "login-result") {
        setState(m.ok ? { step: "choose" } : {
          step: "failed",
          message: m.duplicateOf
            ? `${m.email} is already added as "${m.duplicateOf}". Sign in with a different Anthropic account (sign out of claude.ai in your browser first, or open the link in a private window).`
            : "The code didn't work. Start again and paste the new code.",
        });
        if (m.ok) doneRef.current(); else changedRef.current?.(); // a rejected sign-in still changes the account list state
      }
    });
    return () => { conn.current?.send({ type: "login-cancel" }); conn.current?.close(); };
  }, [account]);

  // A wrong or expired code can leave the CLI waiting forever: give up after a while instead of spinning endlessly.
  const submitting = state.step === "waiting" && !!state.submitting;
  useEffect(() => {
    if (!submitting) return;
    const t = setTimeout(() => {
      conn.current?.send({ type: "login-cancel" });
      setState({ step: "failed", message: "Sign-in is taking too long — the code may be wrong or expired. Start again to get a new one." });
    }, 45_000);
    return () => clearTimeout(t);
  }, [submitting]);

  return (
    <Login
      state={state}
      onStart={(mode) => { setState({ step: "waiting", mode }); conn.current?.send({ type: "login-start", mode, account }); }}
      onCode={(code) => { setState((s) => (s.step === "waiting" ? { ...s, submitting: true } : s)); conn.current?.send({ type: "login-code", code }); }}
      onCancel={() => { conn.current?.send({ type: "login-cancel" }); setState({ step: "choose" }); }}
    />
  );
}
