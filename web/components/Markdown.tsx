import { useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";

// Assistant text as rich markdown; handles the Copy buttons of code blocks via delegation.
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest("[data-copy]") as HTMLButtonElement | null;
    if (!btn) return;
    const code = btn.closest(".code")?.querySelector("code")?.textContent ?? "";
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    }).catch(() => {});
  };
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
