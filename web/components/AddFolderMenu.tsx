import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { BoilerplateWizard } from "./BoilerplateWizard";

// "Create project": open an existing folder, or start from a boilerplate.
export function AddFolderMenu({ onAdded }: { onAdded: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [wizard, setWizard] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const add = (path?: string) => {
    setOpen(false);
    api<{ id?: string }>("/api/projects", { body: path ? { path } : {} })
      .then((r) => r.id && onAdded(r.id))
      .catch((e) => alert(e.message));
  };

  return (
    <div className="addfolder" ref={ref}>
      <button onClick={() => setOpen(!open)} title="Create or open a project"><Icon name="plus" size={14} /> Create project</button>
      {open && (
        <div className="menu fmenu">
          <div className="b-item new" onClick={() => add()}><Icon name="folderOpen" size={14} /> Open folder…</div>
          <div className="b-item new" onClick={() => { setOpen(false); setWizard(true); }}><Icon name="box" size={14} /> Create from boilerplate…</div>
        </div>
      )}
      {wizard && <BoilerplateWizard onClose={() => setWizard(false)} onCreated={onAdded} />}
    </div>
  );
}
