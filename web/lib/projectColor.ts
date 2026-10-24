import type { CSSProperties } from "react";

// One automatic colour per open folder (spread around the colour wheel by its position), shared by chat and editor tabs.
export const projectTint = (projects: { id: string }[], id: string): CSSProperties => {
  const hue = (Math.max(projects.findIndex((p) => p.id === id), 0) * 137.5 + 15) % 360;
  return { color: `hsl(${hue} 70% var(--proj-l, 72%))`, background: `hsl(${hue} 60% 55% / var(--proj-a, .18))` };
};
