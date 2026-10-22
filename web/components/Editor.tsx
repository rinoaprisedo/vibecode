import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { getTheme, type Theme } from "../lib/theme";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";

// App surfaces on top of the syntax theme, for either mode.
const surface = (dark: boolean) => EditorView.theme({
  "&": { backgroundColor: "var(--editor-bg)", height: "100%", color: "var(--text)" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--faint)" },
  ".cm-activeLine": { backgroundColor: "var(--tint)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(217,119,87,.25) !important" },
  "&.cm-focused": { outline: "none" },
}, { dark });

// Light syntax colours (GitHub-light-like); dark mode uses One Dark.
const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#cf222e" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#0a3069" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#0550ae" },
  { tag: t.comment, color: "#6e7781", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#8250df" },
  { tag: [t.typeName, t.className, t.namespace], color: "#953800" },
  { tag: [t.propertyName, t.attributeName], color: "#0550ae" },
  { tag: t.definition(t.variableName), color: "#953800" },
  { tag: [t.operator, t.punctuation], color: "#57606a" },
  { tag: t.tagName, color: "#116329" },
  { tag: [t.link, t.url], color: "#0969da" },
  { tag: t.heading, color: "#0550ae", fontWeight: "bold" },
]);
const themeExt = (th: Theme) => (th === "dark" ? [oneDark, surface(true)] : [syntaxHighlighting(lightHighlight), surface(false)]);

function langFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js": case "mjs": case "cjs": return javascript({ jsx: true }); // plain .js often holds React/JSX
    case "jsx": return javascript({ jsx: true });                  // React
    case "ts": case "mts": case "cts": return javascript({ typescript: true });
    case "tsx": return javascript({ jsx: true, typescript: true }); // React + TypeScript
    case "go": return go();
    case "php": case "phtml": return php();                        // PHP with embedded HTML/CSS/JS
    case "html": case "htm": case "xhtml": return html();          // with embedded <script> and <style>
    case "css": case "scss": case "less": return css();
    case "py": return python();
    case "md": case "markdown": return markdown();
    case "json": case "jsonc": return json();
    default: return [];
  }
}

// One CodeMirror view; content is replaced whenever `path` or `content` (from disk) changes.
export function Editor({ path, content, onChange, onSave }: {
  path: string; content: string; onChange: (v: string) => void; onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };

  useEffect(() => {
    const lang = new Compartment();
    const themeComp = new Compartment();
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(), history(), indentOnInput(), bracketMatching(), highlightActiveLine(),
          search({ top: true }), highlightSelectionMatches(),
          // Short labels so the find bar stays compact (like VS Code's widget).
          EditorState.phrases.of({
            next: "↓", previous: "↑", all: "All", "match case": "Aa", regexp: ".*", "by word": "ab",
            replace: "Replace", "replace all": "All", Find: "Find", Replace: "Replace",
          }),
          themeComp.of(themeExt(getTheme())), lang.of(langFor(path)),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (cb.current.onSave(), true) },
            indentWithTab, ...searchKeymap, ...defaultKeymap, ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString())),
        ],
      }),
    });
    view.current = v;
    const restyle = () => v.dispatch({ effects: themeComp.reconfigure(themeExt(getTheme())) });
    window.addEventListener("themechange", restyle);
    return () => { window.removeEventListener("themechange", restyle); v.destroy(); };
  }, [path]);

  // External content change (reload from disk): swap the doc without recreating the view.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== content)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: content } });
  }, [content]);

  return <div className="editor" ref={host} />;
}
