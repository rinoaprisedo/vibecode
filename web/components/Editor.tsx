import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";

// Sits on top of oneDark: keeps its syntax colors, swaps in the app's surfaces.
const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--editor-bg)", height: "100%" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--faint)" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.035)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(217,119,87,.25) !important" },
  "&.cm-focused": { outline: "none" },
}, { dark: true });

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
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(), history(), indentOnInput(), bracketMatching(), highlightActiveLine(),
          oneDark, editorTheme, lang.of(langFor(path)),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (cb.current.onSave(), true) },
            indentWithTab, ...defaultKeymap, ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString())),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [path]);

  // External content change (reload from disk): swap the doc without recreating the view.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== content)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: content } });
  }, [content]);

  return <div className="editor" ref={host} />;
}
