import { renderMessageInline } from "./messageLinks";

/* ============================================================
   Рендер Markdown
   ============================================================ */

export function renderMarkdown(text, onWebLink) {
  if (!text) return "";
  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const formatInline = (html) => html
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/(?<!\*)\*(?![\s*])([^*\n]+?)(?<!\s)\*(?!\*)/g, "<em>$1</em>")
      .replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?]|$)/g, "$1<em>$2</em>");
  const inline = (value) => renderMessageInline(value, escapeHtml, formatInline, onWebLink);

  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      if (code === null) code = [];
      else {
        blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    const item = line.match(/^\s*(?:[-+*])\s+(.+)$/) || line.match(/^\s*\d+[.)]\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item) {
      flushParagraph();
      const type = /^\s*\d+[.)]\s+/.test(line) ? "ol" : "ul";
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push(item[1]);
    } else if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${inline(quote[1])}</blockquote>`);
    } else if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  if (code !== null) blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return blocks.join("");
}

export function parseMessageMarkdown(text) {
  let previewUrl = null;
  const html = renderMarkdown(text, (url) => { previewUrl ??= url; });
  return { html, previewUrl };
}
