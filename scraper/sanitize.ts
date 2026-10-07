import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

const ALLOWED = new Set(["p", "h3", "b", "strong", "i", "em", "br", "a"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "img", "noscript", "svg", "form", "button"]);

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

function render(nodes: AnyNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += escapeText(node.data.replace(/­/g, ""));
    } else if (node.type === "tag") {
      const tag = node.name.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) continue;
      if (tag === "div" && node.attribs.id === "ad_oop") continue;
      const inner = render(node.children);
      if (!ALLOWED.has(tag)) { out += inner; continue; }
      if (tag === "br") { out += "<br>"; continue; }
      if (tag === "a") {
        const href = node.attribs.href ?? "";
        out += /^https?:\/\//i.test(href)
          ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
          : inner;
        continue;
      }
      out += `<${tag}>${inner}</${tag}>`;
    }
  }
  return out;
}

/** Reduces article body HTML to a small allowlist of tags. Everything else is unwrapped or dropped. */
export function sanitizeBody(html: string): string {
  const $ = cheerio.load(html, null, false);
  return render($.root().contents().toArray())
    .replace(/(<br>\s*){3,}/g, "<br><br>")
    .replace(/<p>(\s|<br>)*<\/p>/g, "")
    .trim();
}
