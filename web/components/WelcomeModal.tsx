import { useState } from "react";
import { api } from "../lib/api";
import { LOGO } from "../lib/logo";
import { Icon } from "./Icon";
import { BoilerplateWizard } from "./BoilerplateWizard";
import type { Account } from "./AccountMenu";

// Shown on first launch (and whenever no project is open), until one is added: explains the first steps and offers the same two
// ways to start as the "Create project" button.
export function WelcomeModal({ accounts, onAdded, onSignIn }: {
  accounts: Account[]; onAdded: (id: string) => void; onSignIn: () => void;
}) {
  const [wizard, setWizard] = useState(false);
  const [busy, setBusy] = useState(false);
  const signedIn = accounts.some((a) => a.loggedIn);

  const openFolder = () => {
    setBusy(true);
    api<{ id?: string }>("/api/projects", { body: {} })
      .then((r) => r.id && onAdded(r.id))
      .catch((e) => alert(e.message))
      .finally(() => setBusy(false));
  };

  if (wizard) return <BoilerplateWizard onClose={() => setWizard(false)} onCreated={onAdded} />;

  return (
    <div className="modal-backdrop">
      <div className="modal welcome" role="dialog" aria-label="Welcome to Vibecoder">
        <div className="wl-hero">
          <img className="wl-logo" src={LOGO} alt="" />
          <h2>Welcome to Vibecoder</h2>
          <p>Claude works inside a project folder. Add one to get started.</p>
        </div>

        <div className="wl-choices">
          <button className="wl-card" disabled={busy} onClick={openFolder}>
            <span className="wl-cico"><Icon name="folderOpen" size={22} /></span>
            <span className="wl-ctxt"><b>Open a folder</b><small>Use a project that is already on your Mac.</small></span>
            <span className="wl-go"><Icon name="plus" size={14} /></span>
          </button>
          <button className="wl-card hl" onClick={() => setWizard(true)}>
            <span className="wl-cico"><Icon name="box" size={22} /></span>
            <span className="wl-ctxt"><b>Create from boilerplate</b><small>Start a new project from a ready-made template.</small></span>
            <span className="wl-go"><Icon name="plus" size={14} /></span>
          </button>
        </div>

        <ol className="wl-steps">
          <li className="on"><span className="wl-n">1</span><span><b>Add a project</b><small>Pick one of the two options above. You can add more later with <i>Create project</i> in the sidebar.</small></span></li>
          <li className={signedIn ? "done" : ""}>
            <span className="wl-n">{signedIn ? <Icon name="check" size={12} /> : 2}</span>
            <span>
              <b>Sign in to Claude</b>
              <small>{signedIn ? "You are signed in." : <>Needed before you can chat. <button className="wl-link" onClick={onSignIn}>Sign in now</button></>}</small>
            </span>
          </li>
          <li><span className="wl-n">3</span><span><b>Ask Claude to build</b><small>Describe what you want in the chat. You review and approve each change.</small></span></li>
        </ol>

      </div>
    </div>
  );
}
