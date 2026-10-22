import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "vibecode.theme";

export const getTheme = (): Theme => {
  try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
};

// Sets <html data-theme>, remembers it, and tells the editor/terminal (which don't use CSS variables) to restyle.
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch {}
  window.dispatchEvent(new Event("themechange"));
}

export function useTheme(): Theme {
  const [t, setT] = useState<Theme>(getTheme);
  useEffect(() => {
    const h = () => setT(getTheme());
    window.addEventListener("themechange", h);
    return () => window.removeEventListener("themechange", h);
  }, []);
  return t;
}
