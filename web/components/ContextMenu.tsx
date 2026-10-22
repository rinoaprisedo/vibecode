import { useEffect, useRef } from "react";

export type MenuItem = { label: string; onClick: () => void; disabled?: boolean } | "sep";

// Small right-click menu, positioned at the cursor and kept inside the window.
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + "px";
    el.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + "px";
    const close = (e: Event) => { if (!(e instanceof MouseEvent && ref.current?.contains(e.target as Node))) onClose(); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", close); window.removeEventListener("blur", onClose);
      window.removeEventListener("keydown", key); window.removeEventListener("resize", onClose);
    };
  }, []);

  return (
    <div className="ctx" ref={ref} style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it === "sep"
        ? <div key={i} className="ctx-sep" />
        : <div key={i} className={"ctx-item" + (it.disabled ? " off" : "")} onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}>{it.label}</div>)}
    </div>
  );
}

// Close / Close Others / Close to the Right / Close to the Left / Close All for a row of tabs.
export function tabMenu(ids: string[], index: number, close: (ids: string[]) => void): MenuItem[] {
  return [
    { label: "Close", onClick: () => close([ids[index]]) },
    { label: "Close Others", onClick: () => close(ids.filter((_, i) => i !== index)), disabled: ids.length < 2 },
    "sep",
    { label: "Close to the Right", onClick: () => close(ids.slice(index + 1)), disabled: index >= ids.length - 1 },
    { label: "Close to the Left", onClick: () => close(ids.slice(0, index)), disabled: index === 0 },
    "sep",
    { label: "Close All", onClick: () => close(ids) },
  ];
}
