import { useEffect, useRef, useState } from "react";
import { connect } from "../lib/api";
import { Login, type LoginState } from "./Login";

// Sign-in for one specific Claude account: pick type, open browser, paste the code.
export function LoginFlow({ account, onDone }: { account: string; onDone: () => void }) {
  const [state, setState] = useState<LoginState>({ step: "choose" });
  const conn = useRef<ReturnType<typeof connect> | undefined>(undefined);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    conn.current = connect((m) => {
      if (m.account !== account) return;
      if (m.type === "login-url") setState((l) => (l.step === "waiting" ? { ...l, url: m.url } : l));
      else if (m.type === "login-result") {
        setState(m.ok ? { step: "choose" } : { step: "failed" });
        if (m.ok) doneRef.current();
      }
    });
    return () => { conn.current?.send({ type: "login-cancel" }); conn.current?.close(); };
  }, [account]);

  return (
    <Login
      state={state}
      onStart={(mode) => { setState({ step: "waiting", mode }); conn.current?.send({ type: "login-start", mode, account }); }}
      onCode={(code) => conn.current?.send({ type: "login-code", code })}
      onCancel={() => { conn.current?.send({ type: "login-cancel" }); setState({ step: "choose" }); }}
    />
  );
}
