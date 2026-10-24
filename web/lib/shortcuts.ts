import { useEffect, useState } from "react";

// Two-key shortcuts: one modifier + one letter/digit, stored as "Alt+1", "Ctrl+K", "Meta+J".
export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
// Combos the app or the OS already uses (clipboard, quick open, find, save, window/tab handling, ...).
const RESERVED = new Set("ACVXZYFGPSWQRTNLHM".split(""));
const keyOf = (e: KeyboardEvent) => (/^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit([0-9])$/.exec(e.code)?.[1] ?? "");
export const comboOf = (e: KeyboardEvent): string => {
  if (e.shiftKey) return "";
  const k = keyOf(e); if (!k) return "";
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.metaKey && "Meta"].filter(Boolean) as string[];
  return mods.length === 1 ? `${mods[0]}+${k}` : "";
};
export const reservedCombo = (c: string) => { const [m, k] = c.split("+"); return (m === "Ctrl" || m === "Meta") && RESERVED.has(k); };
export const pretty = (c: string) => { if (!c) return ""; const [m, k] = c.split("+"); return isMac ? ({ Ctrl: "⌃", Alt: "⌥", Meta: "⌘" } as Record<string, string>)[m] + k : `${m}+${k}`; };

// App-wide shortcuts that can be changed in Settings (kept in this browser/app, like the other UI preferences).
export type AppShortcuts = { focusChat: string; newChat: string };
export const DEFAULT_SHORTCUTS: AppShortcuts = { focusChat: "Alt+C", newChat: "Alt+N" };
export const SHORTCUT_LABELS: Record<keyof AppShortcuts, string> = { focusChat: "Focus the message box", newChat: "New chat tab" };
const KEY = "vibecode.shortcuts";

export function getShortcuts(): AppShortcuts {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const pick = (k: keyof AppShortcuts) => (typeof raw[k] === "string" && /^(Ctrl|Alt|Meta|)(\+[A-Z0-9])?$/.test(raw[k]) ? raw[k] : DEFAULT_SHORTCUTS[k]);
    return { focusChat: pick("focusChat"), newChat: pick("newChat") }; // "" = switched off
  } catch { return { ...DEFAULT_SHORTCUTS }; }
}
export function setShortcuts(next: AppShortcuts) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  window.dispatchEvent(new Event("shortcutschange"));
}
export function useShortcuts(): AppShortcuts {
  const [s, setS] = useState(getShortcuts);
  useEffect(() => {
    const h = () => setS(getShortcuts());
    window.addEventListener("shortcutschange", h);
    return () => window.removeEventListener("shortcutschange", h);
  }, []);
  return s;
}
