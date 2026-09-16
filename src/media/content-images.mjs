// Source-preserving HTML image pass. Edits only verified URL attribute spans;
// unrelated markup, captions, attributes, quoting, and srcset descriptors survive.
const CONTAINERS = new Set(["a", "figure", "picture"]);
const IMAGE_ATTRIBUTES = new Set(["src", "data-src", "data-lazy-src", "data-original", "data-lazy", "srcset", "data-srcset"]);

function decodeAttribute(value) {
  const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code) => {
    if (!code.startsWith("#")) return named[code.toLowerCase()];
    const hex = code[1].toLowerCase() === "x";
    const number = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

function escapeAttribute(value) {
  return value.replace(/[&<>"'\s=`]/g, (char) => `&#${char.codePointAt(0)};`);
}

function attributes(tag, offset) {
  const result = [];
  const seen = new Set();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  // Skip the tag name; indices still refer to the original source bytes.
  pattern.lastIndex = /^<\s*[\w:-]+/.exec(tag)?.[0].length || tag.length;
  for (let match; (match = pattern.exec(tag));) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (value === undefined || seen.has(name)) continue;
    seen.add(name);
    const equals = match[0].indexOf("=");
    const afterEquals = match[0].slice(equals + 1).search(/\S/);
    const quoted = match[2] !== undefined || match[3] !== undefined;
    const start = offset + match.index + equals + 1 + afterEquals + (quoted ? 1 : 0);
    result.push({ name, value, start, end: start + value.length });
  }
  return result;
}

function srcsetParts(value) {
  // Data URLs and parenthesized/ambiguous syntax are retained as a whole.
  if (/data:|[()]/i.test(value)) return null;
  const parts = [];
  let offset = 0;
  for (const part of value.split(",")) {
    const match = /^(\s*)([^\s,]+)(?:\s+((?:[1-9]\d*w)|(?:(?:\d+(?:\.\d+)?|\.\d+)x)))?\s*$/.exec(part);
    if (!match || (match[3]?.endsWith("x") && Number.parseFloat(match[3]) <= 0)) return null;
    parts.push({ value: match[2], start: offset + match[1].length });
    offset += part.length + 1;
  }
  return parts;
}

export function inspectContentImages(html) {
  const references = [];
  const ranges = [];
  const stack = [];
  function addAttribute(attribute) {
    if (attribute.name.endsWith("srcset")) {
      const parts = srcsetParts(attribute.value);
      if (!parts) {
        references.push({ ...attribute, reason: "unsupported-srcset" });
        return;
      }
      for (const part of parts) references.push({
        name: attribute.name, value: part.value,
        start: attribute.start + part.start, end: attribute.start + part.start + part.value.length
      });
    } else references.push(attribute);
  }
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const close = html.indexOf("-->", start + 4);
      cursor = close < 0 ? html.length : close + 3;
      continue;
    }
    const match = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/i.exec(html.slice(start));
    if (!match) { cursor = start + 1; continue; }
    let end = start + match[0].length;
    let quote = "";
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === html.length) break;
    end++;
    cursor = end;
    const name = match[2].toLowerCase();
    const closing = Boolean(match[1]);
    if (!closing && ["script", "style", "textarea", "title"].includes(name)) {
      const close = new RegExp(`<\\/\\s*${name}\\s*>`, "ig");
      close.lastIndex = end;
      cursor = close.exec(html) ? close.lastIndex : html.length;
      continue;
    }
    if (closing) {
      const index = stack.findLastIndex((node) => node.name === name);
      if (index >= 0) {
        const node = stack[index];
        if (node.hasImage) {
          ranges.push({ start: node.start, end });
          if (name === "a") for (const attr of node.attrs.filter((a) => a.name === "href")) addAttribute(attr);
        }
        stack.length = index;
      }
      continue;
    }
    const attrs = attributes(html.slice(start, end), start);
    if (CONTAINERS.has(name)) stack.push({ name, start, attrs, hasImage: false });
    if (name === "img") {
      ranges.push({ start, end });
      for (const node of stack) node.hasImage = true;
      for (const attr of attrs.filter((a) => IMAGE_ATTRIBUTES.has(a.name))) addAttribute(attr);
    } else if (name === "source" && stack.some((node) => node.name === "picture")) {
      for (const attr of attrs.filter((a) => a.name === "srcset" || a.name === "data-srcset")) addAttribute(attr);
    }
  }
  // Preserve a malformed/unclosed media container rather than flattening it.
  for (const node of stack) if (node.hasImage) ranges.push({ start: node.start, end: html.length });
  const outerRanges = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = outerRanges.at(-1);
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
    else outerRanges.push({ ...range });
  }
  return { references, ranges: outerRanges };
}

export function transformOutsideContentImages(html, transform, separator = "", preserve = (part) => part) {
  const { ranges } = inspectContentImages(html);
  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    parts.push(transform(html.slice(cursor, range.start)), preserve(html.slice(range.start, range.end)));
    cursor = range.end;
  }
  parts.push(transform(html.slice(cursor)));
  return parts.filter(Boolean).join(separator);
}

export function contentImageUrl(value, baseUrl) {
  try { return new URL(decodeAttribute(value), baseUrl).href; } catch { return null; }
}

function reportUrl(value, baseUrl) {
  try {
    const url = new URL(decodeAttribute(value), baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "[unsupported URL]";
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.href;
  } catch { return "[invalid URL]"; }
}

export async function localiseContentImages(html, { resolver, baseUrl }) {
  const { references } = inspectContentImages(html);
  const changes = [];
  const diagnostics = new Map();
  const candidates = references.filter((ref) => !ref.reason && !resolver.isLocalMediaUrl(decodeAttribute(ref.value)));
  await resolver.prepareUrls(candidates.map((ref) => contentImageUrl(ref.value, baseUrl)).filter(Boolean));
  for (const ref of references) {
    if (resolver.isLocalMediaUrl(decodeAttribute(ref.value))) continue;
    const url = contentImageUrl(ref.value, baseUrl);
    const localUrl = !ref.reason && url ? resolver.resolveMediaUrl(url) : null;
    const reason = localUrl ? "verified-media" : ref.reason || (url ? resolver.unresolvedMediaUrlReason(url) : "invalid-media-url");
    const sourceUrl = ref.reason ? "[unsupported srcset]" : reportUrl(ref.value, baseUrl);
    const key = JSON.stringify([ref.name, sourceUrl, reason]);
    const entry = diagnostics.get(key) || {
      attribute: ref.name, sourceUrl, status: localUrl ? "localised" : "retained",
      reason, count: 0, ...(localUrl ? { localUrl } : {})
    };
    entry.count++;
    diagnostics.set(key, entry);
    if (localUrl) changes.push({ ...ref, replacement: escapeAttribute(localUrl) });
  }
  let output = html;
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, change.start) + change.replacement + output.slice(change.end);
  }
  return { output, diagnostics: [...diagnostics.values()], references };
}
