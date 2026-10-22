import { Marked } from "marked";
import DOMPurify from "dompurify";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import { javascriptLanguage, typescriptLanguage, jsxLanguage, tsxLanguage } from "@codemirror/lang-javascript";
import { pythonLanguage } from "@codemirror/lang-python";
import { jsonLanguage } from "@codemirror/lang-json";
import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { goLanguage } from "@codemirror/lang-go";
import { phpLanguage } from "@codemirror/lang-php";

const PARSERS: Record<string, Parser> = {
  js: javascriptLanguage.parser, javascript: javascriptLanguage.parser, mjs: javascriptLanguage.parser,
  jsx: jsxLanguage.parser, ts: typescriptLanguage.parser, typescript: typescriptLanguage.parser, tsx: tsxLanguage.parser,
  py: pythonLanguage.parser, python: pythonLanguage.parser,
  json: jsonLanguage.parser, jsonc: jsonLanguage.parser,
  css: cssLanguage.parser, html: htmlLanguage.parser, xml: htmlLanguage.parser,
  go: goLanguage.parser, golang: goLanguage.parser,
  php: phpLanguage.parser,
  md: markdownLanguage.parser, markdown: markdownLanguage.parser,
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Token spans use .tok-* classes (styled in styles.css); languages without a parser stay plain.
function highlight(code: string, lang: string): string {
  if (lang === "diff" || lang === "patch") {
    return code.split("\n").map((l) => {
      const cls = l.startsWith("+") && !l.startsWith("+++") ? "d-add" : l.startsWith("-") && !l.startsWith("---") ? "d-del" : l.startsWith("@@") ? "d-hunk" : "";
      return `<span class="${cls}">${esc(l)}</span>`;
    }).join("\n");
  }
  const parser = PARSERS[lang];
  if (!parser) return esc(code);
  let out = "";
  highlightCode(code, parser.parse(code), classHighlighter,
    (text, classes) => { out += classes ? `<span class="${classes}">${esc(text)}</span>` : esc(text); },
    () => { out += "\n"; });
  return out;
}

const marked = new Marked({ gfm: true, breaks: false });
marked.use({
  renderer: {
    // Code fence: header with language + copy button, like the VS Code chat view.
    code({ text, lang }) {
      const l = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
      return `<div class="code"><div class="code-head"><span>${esc(l || "text")}</span><button class="copy" data-copy>Copy</button></div><pre><code>${highlight(text, l)}</code></pre></div>`;
    },
    link({ href, title, tokens }) {
      const t = title ? ` title="${esc(title)}"` : "";
      return `<a href="${esc(href)}"${t} target="_blank" rel="noreferrer noopener">${this.parser.parseInline(tokens)}</a>`;
    },
    // Wrap tables so wide ones scroll instead of overflowing the panel.
    table(token) {
      const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
      const body = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    },
  },
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noreferrer noopener"); }
});

// Model output is untrusted: always sanitize the generated HTML.
export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(marked.parse(src) as string, { ADD_ATTR: ["target", "data-copy"] });
}
