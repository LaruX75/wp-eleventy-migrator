// Generic WPBakery content-preserving transformer.
//
// This is the first WPBakery transformer. Its scope is intentionally
// narrow: it removes structural `[vc_row]`/`[vc_column]` wrappers,
// preserves inner content recursively, and converts a small set of
// leaf shortcodes into readable semantic HTML. It does not attempt to
// reproduce WPBakery's full visual layout and does not fetch anything.
// Attachment images use only the engine-provided, prepared media resolver.
//
// Everything else is passed through as a safely-preserved HTML
// comment plus an unhandled-unit diagnostic — the invariant is
// simple: raw `[vc_*]` shortcode syntax must never survive visibly
// into the migrated Markdown/HTML output.

import { parseShortcodes } from "../shortcode-parser.mjs";
import { attachmentId } from "../../media/attachment-resolver.mjs";

// Shortcodes whose only role is structural (grid, container, or a
// text-only wrapper). Handling strategy: drop the wrapper and
// recursively render the children.
const STRUCTURAL_WRAPPERS = new Set([
  "vc_row",
  "vc_column",
  "vc_row_inner",
  "vc_column_inner",
  "vc_column_text"
]);

// Shortcodes WordPress accepts as a single opening tag with no
// `[/name]` closer. Registered with the parser so they parse as
// self-closing leaves.
const SELF_CLOSING = new Set([
  "vc_empty_space",
  "vc_custom_heading",
  "vc_single_image",
  "vc_video"
]);

const TRANSFORMER_NAME = "wpbakery";

/**
 * Transform a raw content string. Returns the rewritten string plus
 * a plan describing which units were handled, which remain
 * unresolved, and which source spans were preserved verbatim.
 *
 * @param {string} content
 * @param {{resolveMediaById?: Function, unresolvedMediaReason?: Function}} [context]
 *   Synchronous resolver returns {url, alt, caption, mime} only for local media
 *   confirmed available by the engine; null means unresolved. No I/O here.
 * @returns {{
 *   output: string,
 *   plan: {
 *     handledUnits: Array<{ transformer: string, unit: string, count: number }>,
 *     unhandledUnits: Array<{ transformer?: string, unit: string, count: number, criticality: string, reason: string }>,
 *     preservedSourceUnits: Array<{ unit: string, count: number, bytes: number }>
 *   }
 * }}
 */
export function transformWpBakery(content, context = {}) {
  const raw = typeof content === "string" ? content : "";
  if (raw.length === 0) {
    return { output: "", plan: emptyPlan() };
  }
  const nodes = parseShortcodes(raw, { selfClosingNames: SELF_CLOSING });
  const ctx = {
    ...context,
    handled: new Map(),      // unit → count
    unhandled: new Map(),    // key(unit+criticality) → { unit, count, criticality, reason }
    preserved: new Map()     // unit → { count, bytes }
  };
  const output = renderNodes(nodes, ctx);

  return {
    output,
    plan: {
      handledUnits: mapToArray(ctx.handled, "handled").map((h) => ({
        transformer: TRANSFORMER_NAME,
        unit: h.unit,
        count: h.count
      })),
      unhandledUnits: [...ctx.unhandled.values()].sort(
        (a, b) => b.count - a.count || a.unit.localeCompare(b.unit)
      ),
      preservedSourceUnits: [...ctx.preserved.values()].sort(
        (a, b) => b.count - a.count || a.unit.localeCompare(b.unit)
      )
    }
  };
}

/**
 * True iff the shortcode name is one this transformer claims to
 * handle. Used by the render dispatcher and by future transformer
 * priority resolution.
 */
export function handlesUnit(unitName) {
  if (STRUCTURAL_WRAPPERS.has(unitName)) return true;
  if (SELF_CLOSING.has(unitName)) return true;
  return false;
}

// Discover only valid vc_single_image IDs using the same AST as rendering.
export function collectWpBakeryMediaIds(content) {
  const ids = new Set();
  function visit(nodes) {
    for (const node of nodes) {
      if (node.type !== "shortcode") continue;
      if (node.name === "vc_single_image") {
        const id = attachmentId(node.attrs?.image);
        if (id) ids.add(id);
      }
      visit(node.children || []);
    }
  }
  visit(parseShortcodes(content, { selfClosingNames: SELF_CLOSING }));
  return [...ids];
}

function metadataText(value) {
  const text = String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
  // Invalid entities in remote metadata must not abort the migration.
  try { return decodeHtmlEntities(text); } catch { return text; }
}

// ---------- rendering ------------------------------------------------------

function renderNodes(nodes, ctx) {
  let out = "";
  for (const node of nodes || []) {
    out += renderNode(node, ctx);
  }
  return out;
}

function renderNode(node, ctx) {
  if (node.type === "text") return node.value;
  if (node.type === "unhandled") {
    // Parser-level unhandled (escaped/malformed). Never surface the
    // raw source visibly; leave a safe HTML comment for downstream
    // review + record a manual-review diagnostic.
    trackUnhandled(ctx, node.kind, "manual-review", node.reason || "Unhandled source unit.");
    trackPreserved(ctx, node.kind, node.end - node.start);
    return `<!-- shortcode-${node.kind} preserved -->`;
  }
  if (node.type === "shortcode") return renderShortcode(node, ctx);
  return "";
}

function renderShortcode(node, ctx) {
  const name = node.name;
  const inner = renderNodes(node.children || [], ctx);

  if (STRUCTURAL_WRAPPERS.has(name)) {
    trackHandled(ctx, name);
    trackPreserved(ctx, name, node.end - node.start);
    return inner;
  }

  if (name === "vc_empty_space") return renderEmptySpace(node, ctx);
  if (name === "vc_custom_heading") return renderCustomHeading(node, ctx);
  if (name === "vc_video") return renderVideo(node, ctx);
  if (name === "vc_single_image") return renderSingleImage(node, ctx);

  // Any other shortcode (vc_*, vcex_*, plugin shortcodes) — never
  // emit visible raw shortcode syntax. Preserve source diagnostic and
  // recurse into children so their content is not dropped either.
  const isWpBakeryFamily = /^(vc_|vcex_)/.test(name);
  trackUnhandled(
    ctx,
    name,
    "manual-review",
    isWpBakeryFamily
      ? "WPBakery unit not handled by the generic transformer; awaits a future page-builder pass."
      : "Non-WPBakery shortcode preserved for downstream handling."
  );
  trackPreserved(ctx, name, node.end - node.start);
  return `<!-- ${isWpBakeryFamily ? "wpbakery" : "shortcode"}-unhandled: ${escapeComment(name)} -->${inner}`;
}

function renderEmptySpace(node, ctx) {
  trackHandled(ctx, "vc_empty_space");
  trackPreserved(ctx, "vc_empty_space", node.end - node.start);
  const height = String(node.attrs?.height || "").trim();
  const style = height ? ` style="height:${escapeAttr(height)}"` : "";
  return `<div class="wp-empty-space" aria-hidden="true"${style}></div>`;
}

function renderCustomHeading(node, ctx) {
  trackHandled(ctx, "vc_custom_heading");
  trackPreserved(ctx, "vc_custom_heading", node.end - node.start);
  const text = String(node.attrs?.text || "").trim();
  if (!text) return "";
  const tag = pickHeadingTag(node.attrs?.font_container || "");
  return `<${tag}>${escapeHtml(decodeHtmlEntities(text))}</${tag}>`;
}

function renderVideo(node, ctx) {
  trackHandled(ctx, "vc_video");
  trackPreserved(ctx, "vc_video", node.end - node.start);
  const link = String(node.attrs?.link || "").trim();
  if (!link) return "";
  const youtubeId = parseYouTubeId(link);
  if (youtubeId) {
    const src = `https://www.youtube.com/embed/${youtubeId}`;
    return (
      `<div class="wp-video-embed">` +
      `<iframe src="${escapeAttr(src)}" title="Embedded video" ` +
      `loading="lazy" allowfullscreen frameborder="0"></iframe>` +
      `</div>`
    );
  }
  // Not a supported embed target — surface as a normal clickable
  // link. Never leave raw `[vc_video …]` syntax in the output.
  return `<p><a href="${escapeAttr(link)}" rel="noopener">${escapeHtml(link)}</a></p>`;
}

function renderSingleImage(node, ctx) {
  const imageId = String(node.attrs?.image || "").trim();
  const id = attachmentId(imageId);
  const media = id ? ctx.resolveMediaById?.(id) : null;
  trackPreserved(ctx, "vc_single_image", node.end - node.start);
  if (media?.url?.startsWith("/") && !media.url.startsWith("//")) {
    trackHandled(ctx, "vc_single_image");
    const caption = metadataText(media.caption);
    return `<figure class="wp-attachment-image" data-attachment-id="${id}">` +
      `<img src="${escapeHtml(media.url)}" alt="${escapeHtml(metadataText(media.alt))}" loading="lazy">` +
      (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "") +
      `</figure>`;
  }
  const reason = id ? (ctx.unresolvedMediaReason?.(id) || "media-id-unresolved") : "missing-or-invalid-attachment-id";
  trackUnhandled(
    ctx, "vc_single_image", "manual-review",
    `WPBakery vc_single_image${id ? ` attachment #${id}` : ""}: ${reason}.`,
    id
  );
  const idAttr = imageId ? ` data-media-unresolved-id="${escapeAttr(imageId)}"` : "";
  return (
    `<figure class="wp-media-unresolved"${idAttr}>` +
    `<!-- vc_single_image unresolved: ${escapeComment(reason)} -->` +
    `</figure>`
  );
}

// ---------- helpers --------------------------------------------------------

function trackHandled(ctx, unit) {
  ctx.handled.set(unit, (ctx.handled.get(unit) || 0) + 1);
}

function trackUnhandled(ctx, unit, criticality, reason, attachmentId = null) {
  const key = `${unit}::${criticality}::${attachmentId ?? ""}`;
  const existing = ctx.unhandled.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    ctx.unhandled.set(key, {
      transformer: TRANSFORMER_NAME,
      ...(attachmentId !== null ? { attachmentId } : {}),
      unit,
      count: 1,
      criticality,
      reason
    });
  }
}

function trackPreserved(ctx, unit, bytes) {
  const cur = ctx.preserved.get(unit) || { unit, count: 0, bytes: 0 };
  cur.count += 1;
  cur.bytes += Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  ctx.preserved.set(unit, cur);
}

function mapToArray(map /* Map<string, number> */) {
  const arr = [];
  for (const [unit, count] of map.entries()) arr.push({ unit, count });
  return arr.sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit));
}

function emptyPlan() {
  return { handledUnits: [], unhandledUnits: [], preservedSourceUnits: [] };
}

function pickHeadingTag(fontContainer) {
  // `font_container` is pipe-separated: "tag:h3|text_align:center|color:%23416972".
  const match = String(fontContainer || "").match(/(?:^|\|)tag:(h[1-6])(?=\||$)/i);
  if (match) return match[1].toLowerCase();
  return "h2";
}

function parseYouTubeId(url) {
  const m = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([A-Za-z0-9_-]{6,20})/
  );
  return m ? m[1] : null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeComment(s) {
  // HTML comments can't safely contain `--`; keep the diagnostic
  // ASCII-only and short.
  return String(s).replace(/-{2,}/g, "-").replace(/[<>]/g, "");
}

// Named HTML entities WPBakery / Total-theme content commonly emits
// inside `text=""` attributes. Numeric entities (`&#nnn;`, `&#xNNN;`)
// are decoded generically via String.fromCodePoint.
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", aring: "å", Aring: "Å",
  uuml: "ü", Uuml: "Ü", szlig: "ß", eacute: "é", Eacute: "É",
  agrave: "à", egrave: "è", ecirc: "ê", ccedil: "ç", ntilde: "ñ",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”"
};

function decodeHtmlEntities(s) {
  // WPBakery's `font_container` puts hex colors like `%23416972` in
  // attributes; the `text` attribute itself can carry HTML entities
  // (`&amp;`, `&nbsp;`, `&auml;`, `&#8211;`, `&#x2013;`). Decode both
  // named entities from the small allow-list and numeric entities
  // generically so headings read naturally in the migrated output.
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, code) => {
    if (code[0] === "#") {
      const hex = code[1] === "x" || code[1] === "X";
      const raw = hex ? code.slice(2) : code.slice(1);
      const v = Number.parseInt(raw, hex ? 16 : 10);
      return Number.isNaN(v) ? full : String.fromCodePoint(v);
    }
    if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, code)) {
      return NAMED_ENTITIES[code];
    }
    return full;
  });
}
