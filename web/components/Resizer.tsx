// Thin drag handle between two columns. `onDrag` receives how far the pointer moved since the drag began.
export function Resizer({ onStart, onDrag, onDone }: { onStart?: () => void; onDrag: (dx: number) => void; onDone?: () => void }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    document.body.classList.add("resizing");
    onStart?.();
    const move = (ev: MouseEvent) => onDrag(ev.clientX - x0);
    const up = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      onDone?.();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return <div className="resizer" onMouseDown={start} role="separator" aria-orientation="vertical" />;
}
