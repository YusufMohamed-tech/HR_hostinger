const allowedTags = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "i",
  "li",
  "ol",
  "p",
  "span",
  "strong",
  "u",
  "ul",
]);

const removableBlocks = /<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const htmlToken = /<!--[\s\S]*?-->|<\/?[a-z][^>]*>/giu;

function escapeText(value: string) {
  return value.replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function escapeAttribute(value: string) {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");
}

export function safeExternalUrl(value: string) {
  const candidate = value.trim();
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeLinkTarget(value: string) {
  const candidate = value.trim();
  if (/^(#|\/(?!\/))/u.test(candidate)) return candidate;
  if (/^(mailto:|tel:)/iu.test(candidate)) return candidate;
  return safeExternalUrl(candidate);
}

function sanitizeTag(token: string) {
  if (token.startsWith("<!--")) return "";
  const match = token.match(/^<\s*(\/?)\s*([a-z0-9]+)/iu);
  if (!match) return "";
  const closing = match[1] === "/";
  const tag = match[2].toLowerCase();
  if (!allowedTags.has(tag)) return "";
  if (closing) return tag === "br" ? "" : `</${tag}>`;
  if (tag === "br") return "<br>";
  if (tag !== "a") return `<${tag}>`;

  const hrefMatch = token.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu);
  const href = safeLinkTarget(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "");
  return href
    ? `<a href="${escapeAttribute(href)}" rel="noopener noreferrer">`
    : "<a>";
}

export function sanitizeRichTextHtml(value: string) {
  const source = value.replace(removableBlocks, "");
  let output = "";
  let offset = 0;

  for (const match of source.matchAll(htmlToken)) {
    const index = match.index ?? offset;
    output += escapeText(source.slice(offset, index));
    output += sanitizeTag(match[0]);
    offset = index + match[0].length;
  }
  output += escapeText(source.slice(offset));
  return output.trim();
}
