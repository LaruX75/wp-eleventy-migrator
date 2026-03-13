#!/usr/bin/env node
/**
 * visual-audit.mjs
 *
 * MODE 1 — single page (file or URL):
 *   node scripts/visual-audit.mjs ./ui/index.html
 *   node scripts/visual-audit.mjs https://example.com
 *
 * MODE 2 — site crawl (WordPress REST API → rendered front-end pages):
 *   node scripts/visual-audit.mjs --site https://example.com
 *   node scripts/visual-audit.mjs --site https://example.com --types pages,posts
 *   node scripts/visual-audit.mjs --site https://example.com --all-pages
 *   node scripts/visual-audit.mjs --site https://example.com --auth user:app-password
 *   node scripts/visual-audit.mjs --site https://example.com --bearer TOKEN
 *
 * Shared options:
 *   --json              Output machine-readable JSON only
 *   --out <file>        Save report JSON to file
 *   --concurrency <n>   Parallel fetch limit (default: 3)
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const eqVal = args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  if (eqVal != null) return eqVal;
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")
    ? args[idx + 1] : null;
};

const siteMode   = opt("--site");
const jsonOnly   = flag("--json");
const allPages   = flag("--all-pages");
const outArg     = opt("--out");
const authOpt    = opt("--auth");       // "user:pass"
const bearerOpt  = opt("--bearer");
const typesOpt   = opt("--types") ?? "pages";
const concurrency = parseInt(opt("--concurrency") ?? "3", 10);
const target     = !siteMode ? args.find((a) => !a.startsWith("--")) : null;

if (!siteMode && !target) {
  console.error([
    "Usage:",
    "  Single page:  node scripts/visual-audit.mjs <file-or-url> [--json] [--out report.json]",
    "  Site crawl:   node scripts/visual-audit.mjs --site <wp-base-url>",
    "                  [--types pages,posts] [--all-pages]",
    "                  [--auth user:app-password] [--bearer TOKEN]",
    "                  [--concurrency 3] [--json] [--out report.json]",
  ].join("\n"));
  process.exit(1);
}

// ── ANSI colours ─────────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
  blue:   "\x1b[34m",
  magenta:"\x1b[35m",
};

const log  = (...a) => { if (!jsonOnly) process.stderr.write(a.join(" ") + "\n"); };
const tick = (msg) => log(`${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => log(`${c.yellow}⚠${c.reset}  ${msg}`);

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function buildHeaders() {
  const h = { "User-Agent": "visual-audit/1.0" };
  if (bearerOpt) { h["Authorization"] = `Bearer ${bearerOpt}`; }
  else if (authOpt) { h["Authorization"] = `Basic ${Buffer.from(authOpt).toString("base64")}`; }
  return h;
}

async function fetchText(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { ...buildHeaders(), ...extraHeaders } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function readOrFetch(src) {
  if (/^https?:\/\//.test(src)) return { html: await fetchText(src), base: src };
  const abs = path.resolve(src);
  return { html: await fs.readFile(abs, "utf8"), base: `file://${abs}` };
}

/** Run at most `n` tasks at a time */
async function pool(items, n, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

// ── CSS helpers ───────────────────────────────────────────────────────────────

function extractInlineStyles(html) {
  const r = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) r.push(m[1]);
  return r;
}

function extractLinkedStylesheets(html, base) {
  const hrefs = [];
  for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi))
    hrefs.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']stylesheet["']/gi))
    hrefs.push(m[1]);
  return [...new Set(hrefs)].map((href) => {
    try { return new URL(href, base).href; } catch { return null; }
  }).filter(Boolean);
}

async function fetchLinkedCss(hrefs) {
  const sheets = [];
  for (const href of hrefs) {
    try {
      const text = href.startsWith("file://")
        ? await fs.readFile(fileURLToPath(href), "utf8")
        : await fetchText(href);
      sheets.push({ href, css: text });
    } catch { /* skip */ }
  }
  return sheets;
}

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, " "); }

function extractCssVariables(css) {
  const vars = {};
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g))
    vars[`--${m[1]}`] = m[2].trim();
  return vars;
}

function extractMediaQueries(css) {
  const q = new Set();
  for (const m of css.matchAll(/@media\s+([^{]+)\{/g)) q.add(m[1].trim());
  return [...q];
}

function extractKeyframes(css) {
  const n = new Set();
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) n.add(m[1]);
  return [...n];
}

function extractFonts(css) {
  const f = new Set();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}\n]+)/g))
    for (const p of m[1].split(",")) f.add(p.replace(/["']/g, "").trim());
  return [...f];
}

function extractTransitions(css) {
  const t = new Set();
  for (const m of css.matchAll(/transition\s*:\s*([^;}\n]+)/g)) t.add(m[1].trim());
  return [...t];
}

function extractColors(css) {
  const col = new Set();
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|color-mix\([^)]+\)/g))
    col.add(m[0].trim());
  return [...col];
}

function selectorsWithPseudo(css, pseudo) {
  const found = new Set();
  const clean = stripComments(css);
  for (const m of clean.matchAll(/([^{}]+:[^{}]*)\{/g)) {
    const sel = m[1].trim();
    if (sel.includes(`:${pseudo}`)) found.add(sel.replace(/\s+/g, " ").trim());
  }
  return [...found];
}

function detectMissingStates(css) {
  const clean = stripComments(css);
  const hoverBases = new Set(selectorsWithPseudo(clean, "hover").map((s) =>
    s.replace(/:hover.*/, "").trim()));
  const focusBases = new Set([
    ...selectorsWithPseudo(clean, "focus"),
    ...selectorsWithPseudo(clean, "focus-visible"),
  ].map((s) => s.replace(/:(focus|focus-visible).*/, "").trim()));
  return [...hoverBases].filter((b) => !focusBases.has(b)).map((b) => ({
    base: b, missing: "focus / focus-visible",
  }));
}

/** Full CSS-level audit (used for both single-page and site-wide aggregated CSS) */
function auditCss(allCss) {
  const combined = allCss.map((s) => s.css).join("\n\n");
  const darkMode = combined.includes("prefers-color-scheme: dark")
    ? "CSS @media prefers-color-scheme"
    : combined.match(/\[data-theme=["']dark["']\]/) || combined.match(/\.dark\b/)
    ? "class/attribute toggle"
    : "none detected";
  return {
    sources: allCss.map((s) => ({ source: s.source, bytes: s.css.length })),
    design: {
      cssVariables: extractCssVariables(combined),
      colorCount: extractColors(combined).length,
      colors: extractColors(combined),
      fonts: extractFonts(combined),
      transitions: extractTransitions(combined),
      keyframes: extractKeyframes(combined),
      darkModeStrategy: darkMode,
    },
    responsive: { mediaQueries: extractMediaQueries(combined) },
    interactivity: {
      hoverSelectors:        selectorsWithPseudo(combined, "hover"),
      focusSelectors:        selectorsWithPseudo(combined, "focus"),
      focusVisibleSelectors: selectorsWithPseudo(combined, "focus-visible"),
      disabledSelectors:     selectorsWithPseudo(combined, "disabled"),
      activeSelectors:       selectorsWithPseudo(combined, "active"),
    },
    gaps: { missingFocusStates: detectMissingStates(combined) },
  };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function extractTitle(html) {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
}

function extractMetaContent(html, name) {
  return html.match(new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"
  ))?.[1]?.trim()
  ?? html.match(new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`, "i"
  ))?.[1]?.trim()
  ?? "";
}

function auditSeo(html) {
  return {
    title:       extractTitle(html),
    description: extractMetaContent(html, "description"),
    ogTitle:     extractMetaContent(html, "og:title"),
    ogDescription: extractMetaContent(html, "og:description"),
    ogImage:     extractMetaContent(html, "og:image"),
    canonical:   html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)?.[1]?.trim() ?? "",
    robots:      extractMetaContent(html, "robots"),
    hasSchema:   html.includes('"@context"') && html.includes('"schema.org"'),
  };
}

function auditImages(html, base) {
  const imgs = [...html.matchAll(/<img([^>]*)>/gi)];
  let lazy = 0, missingAlt = 0, external = 0;
  for (const [, attrs] of imgs) {
    if (/loading=["']lazy["']/i.test(attrs)) lazy++;
    if (!/\balt=/i.test(attrs)) missingAlt++;
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    if (srcMatch) {
      try {
        const u = new URL(srcMatch[1], base);
        const b = new URL(base);
        if (u.hostname !== b.hostname) external++;
      } catch { /* skip */ }
    }
  }
  return { total: imgs.length, lazy, missingAlt, external };
}

function auditLinks(html, base) {
  const anchors = [...html.matchAll(/<a[^>]+href=["']([^"'#][^"']*)["']/gi)];
  let internal = 0, external = 0;
  for (const [, href] of anchors) {
    try {
      const u = new URL(href, base);
      const b = new URL(base);
      if (u.hostname === b.hostname) internal++; else external++;
    } catch { /* skip */ }
  }
  return { internal, external };
}

function extractCssClasses(html) {
  const classes = new Set();
  for (const m of html.matchAll(/class=["']([^"']*)["']/g))
    for (const cls of m[1].split(/\s+/).filter(Boolean)) classes.add(cls);
  return [...classes];
}

function detectBlocks(html) {
  const blocks = new Set();
  for (const m of html.matchAll(/<!--\s*wp:([\w/-]+)/g)) blocks.add(m[1]);
  return [...blocks];
}

function detectShortcodes(html) {
  // Strip <style> and <script> blocks first to avoid CSS/JS false positives
  const body = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  const found = new Set();
  for (const m of body.matchAll(/\[([a-z_][a-z0-9_-]*)(?:\s[^\]]*)?]/gi))
    found.add(m[1]);
  return [...found];
}

// ── Block categorisation ──────────────────────────────────────────────────────

const KADENCE_FREE = new Set([
  "advancedheading","rowlayout","spacer","advancedbtn","icon","iconlist",
  "tabs","tab","accordion","pane","infobox","testimonial","testimonials",
  "advancedgallery","form","column","columns","image",
]);
const KADENCE_PRO = new Set([
  "countdown","videopopup","lottie","modal","navigation","off-canvas",
  "show-more","dynamichtml","identity","contentwidget","splitcontent",
  "table-of-contents","postcarousel","portfoliogrid",
]);

function blockVariant(namespace, blockName) {
  if (namespace === "core")    return "core";
  if (namespace === "kadence") return KADENCE_PRO.has(blockName) ? "kadence-pro" : "kadence";
  return "plugin";
}

// ── Page structure extraction ─────────────────────────────────────────────────

/**
 * Parse WordPress block comments into a full recursive tree.
 *
 * Each node:
 *   block       — full name e.g. "wp:kadence/advancedheading"
 *   namespace   — "core" | "kadence" | "acf" | …
 *   blockName   — short name e.g. "advancedheading"
 *   variant     — "core" | "kadence" | "kadence-pro" | "plugin"
 *   attrs       — parsed JSON attributes (uniqueID, level, etc.)
 *   uniqueId    — Kadence uniqueID shorthand (null if absent)
 *   position    — document order index (0-based, counting all tokens)
 *   rawHtml     — actual inner HTML between open and close comment (full, unstripped)
 *   textContent — plain text of inner HTML (stripped, for quick reading)
 *   children    — nested block nodes
 */
function extractBlockTree(html) {
  // ── Tokenise ────────────────────────────────────────────────────────────────
  const tokens = [];
  const re = /<!--\s*(\/?)wp:([\w-]+\/[\w-]+|[\w-]+)\s*(\{[\s\S]*?\})?\s*(\/?)-->/g;
  let docOrder = 0;
  for (const m of html.matchAll(re)) {
    const [full, closing, fullName, attrsStr, selfClose] = m;
    const slashIdx = fullName.indexOf("/");
    const namespace = slashIdx !== -1 ? fullName.slice(0, slashIdx) : "core";
    const blockName = slashIdx !== -1 ? fullName.slice(slashIdx + 1) : fullName;
    let attrs = {};
    if (attrsStr) { try { attrs = JSON.parse(attrsStr); } catch { /* malformed */ } }
    tokens.push({
      closing:   !!closing,
      selfClose: !!selfClose,
      fullName,
      namespace,
      blockName,
      attrs,
      pos:      m.index,
      end:      m.index + full.length,
      docOrder: docOrder++,
    });
  }

  // ── Recursive tree builder ───────────────────────────────────────────────────
  function buildTree(idx, endName) {
    const children = [];
    while (idx < tokens.length) {
      const tok = tokens[idx];

      // Closing tag
      if (tok.closing) {
        if (tok.fullName === endName) return { children, next: idx + 1 };
        idx++; continue; // mismatched — skip
      }

      const { namespace, blockName, attrs, pos, end, docOrder } = tok;
      const blockId = `wp:${tok.fullName}`;
      const variant = blockVariant(namespace, blockName);
      const uniqueId = attrs.uniqueID ?? attrs.uniqueId ?? null;

      if (tok.selfClose) {
        children.push({ block: blockId, namespace, blockName, variant, attrs, uniqueId, position: docOrder, rawHtml: "", textContent: "", children: [] });
        idx++;
      } else {
        const inner = buildTree(idx + 1, tok.fullName);
        // Capture actual inner HTML between this open comment and its close comment
        const closeToken = tokens[inner.next - 1];
        const rawHtml = closeToken
          ? html.slice(end, closeToken.pos)
          : html.slice(end, end + 4000); // fallback: up to 4 KB if no close found
        const textContent = rawHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
        children.push({ block: blockId, namespace, blockName, variant, attrs, uniqueId, position: docOrder, rawHtml, textContent, children: inner.children });
        idx = inner.next;
      }
    }
    return { children, next: idx };
  }

  return buildTree(0, null).children;
}

/**
 * Extract semantic page regions: header, nav, main, article, aside, footer, section.
 * Returns array of { tag, id, classes, role, landmark } — the top-level structural elements.
 */
function extractPageStructure(html) {
  const regions = [];
  const semanticTags = ["header", "nav", "main", "article", "aside", "footer", "section"];
  for (const tag of semanticTags) {
    const re = new RegExp(`<${tag}([^>]*)>`, "gi");
    for (const m of html.matchAll(re)) {
      const attrs = m[1];
      const id      = attrs.match(/\bid=["']([^"']+)["']/i)?.[1] ?? "";
      const classes = (attrs.match(/class=["']([^"']+)["']/i)?.[1] ?? "").split(/\s+/).filter(Boolean);
      const role    = attrs.match(/\brole=["']([^"']+)["']/i)?.[1] ?? "";
      regions.push({ tag, id, classes, role });
    }
  }
  return regions;
}

/**
 * Extract heading outline: h1–h6 with text content, forming a hierarchical map.
 * Returns flat array of { level, text } in document order.
 */
function extractHeadingOutline(html) {
  const outline = [];
  for (const m of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const level = parseInt(m[1], 10);
    const text  = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (text) outline.push({ level, text });
  }
  return outline;
}

/**
 * Extract form structures: each form's action/method and its fields (name, type, label).
 */
function extractForms(html) {
  const forms = [];
  for (const fm of html.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formAttrs = fm[1];
    const body      = fm[2];
    const action  = formAttrs.match(/\baction=["']([^"']*)["']/i)?.[1] ?? "";
    const method  = formAttrs.match(/\bmethod=["']([^"']*)["']/i)?.[1] ?? "get";
    const id      = formAttrs.match(/\bid=["']([^"']*)["']/i)?.[1] ?? "";
    const classes = (formAttrs.match(/class=["']([^"']*)["']/i)?.[1] ?? "").split(/\s+/).filter(Boolean);

    // Collect fields
    const fields = [];
    for (const inp of body.matchAll(/<input([^>]*)>/gi)) {
      const a = inp[1];
      const name  = a.match(/\bname=["']([^"']*)["']/i)?.[1] ?? "";
      const type  = a.match(/\btype=["']([^"']*)["']/i)?.[1] ?? "text";
      const inputId = a.match(/\bid=["']([^"']*)["']/i)?.[1] ?? "";
      // Find matching <label for="id">
      const label = inputId
        ? (html.match(new RegExp(`<label[^>]+for=["']${inputId}["'][^>]*>([^<]+)<`, "i"))?.[1] ?? "").trim()
        : "";
      if (name || type !== "text") fields.push({ name, type, label });
    }
    for (const sel of body.matchAll(/<select([^>]*)>/gi)) {
      const a = sel[1];
      const name = a.match(/\bname=["']([^"']*)["']/i)?.[1] ?? "";
      const selId = a.match(/\bid=["']([^"']*)["']/i)?.[1] ?? "";
      const label = selId
        ? (html.match(new RegExp(`<label[^>]+for=["']${selId}["'][^>]*>([^<]+)<`, "i"))?.[1] ?? "").trim()
        : "";
      if (name) fields.push({ name, type: "select", label });
    }
    for (const ta of body.matchAll(/<textarea([^>]*)>/gi)) {
      const a = ta[1];
      const name = a.match(/\bname=["']([^"']*)["']/i)?.[1] ?? "";
      const taId = a.match(/\bid=["']([^"']*)["']/i)?.[1] ?? "";
      const label = taId
        ? (html.match(new RegExp(`<label[^>]+for=["']${taId}["'][^>]*>([^<]+)<`, "i"))?.[1] ?? "").trim()
        : "";
      if (name) fields.push({ name, type: "textarea", label });
    }

    // Buttons / submits
    const submits = [];
    for (const btn of body.matchAll(/<(?:button|input)[^>]+(?:type=["']submit["'])[^>]*>/gi)) {
      const val = btn[0].match(/value=["']([^"']*)["']/i)?.[1] ?? "";
      const txt = btn[0].match(/>([^<]+)<\/button>/i)?.[1] ?? val;
      submits.push(txt.trim());
    }

    forms.push({ id, classes, action, method, fields, submits });
  }
  return forms;
}

function countWords(html) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.split(" ").length : 0;
}

function detectA11y(html) {
  const issues = [];
  const imgNoAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length;
  if (imgNoAlt) issues.push(`${imgNoAlt} <img> missing alt`);
  if (!html.includes('lang=')) issues.push("No lang attribute on <html>");
  if (!html.includes('<meta name="viewport"')) issues.push("No viewport meta");
  return issues;
}

/** Recursively collect all block entries (name + variant) from a block tree */
function flattenBlockTree(nodes, out = []) {
  for (const node of nodes) {
    out.push({ block: node.block, variant: node.variant, uniqueId: node.uniqueId });
    if (node.children?.length) flattenBlockTree(node.children, out);
  }
  return out;
}

/** Audit a single fetched HTML page (lightweight, no CSS fetch) */
function auditPage(html, url) {
  const blockTree = extractBlockTree(html);
  return {
    url,
    seo:              auditSeo(html),
    images:           auditImages(html, url),
    links:            auditLinks(html, url),
    cssClasses:       extractCssClasses(html),
    // ── Page structure (enables reconstruction) ──────────────────────
    blockTree,
    blocks:           flattenBlockTree(blockTree),   // flat list for aggregation
    pageStructure:    extractPageStructure(html),
    headingOutline:   extractHeadingOutline(html),
    forms:            extractForms(html),
    // ─────────────────────────────────────────────────────────────────
    shortcodes:       detectShortcodes(html),
    stylesheets:      extractLinkedStylesheets(html, url),
    inlineStyleBytes: extractInlineStyles(html).join("").length,
    a11y:             detectA11y(html),
    wordCount:        countWords(html),
  };
}

// ── Single-page full audit ────────────────────────────────────────────────────

async function auditSingle(src) {
  const { html, base } = await readOrFetch(src);
  const inlineBlocks  = extractInlineStyles(html).map((css) => ({ source: "inline", css }));
  const linkedHrefs   = extractLinkedStylesheets(html, base);
  const linkedSheets  = await fetchLinkedCss(linkedHrefs);
  const allCss        = [...inlineBlocks, ...linkedSheets.map(({ href, css }) => ({ source: href, css }))];

  return {
    mode: "single",
    source: src,
    auditedAt: new Date().toISOString(),
    page: auditPage(html, base),
    css: auditCss(allCss),
    htmlMetrics: {
      inputs:    (html.match(/<input[\s>]/gi) || []).length,
      selects:   (html.match(/<select[\s>]/gi) || []).length,
      textareas: (html.match(/<textarea[\s>]/gi) || []).length,
      buttons:   (html.match(/<button[\s>]/gi) || []).length,
      forms:     (html.match(/<form[\s>]/gi) || []).length,
      dialogs:   (html.match(/<dialog[\s>]/gi) || []).length,
      details:   (html.match(/<details[\s>]/gi) || []).length,
    },
  };
}

// ── WordPress REST API site crawl ─────────────────────────────────────────────

const WP_API = "/wp-json/wp/v2";
const FIELDS = "_fields=id,slug,title,link,status,parent,type,date_modified";

async function wpFetchAll(baseUrl, type) {
  const items = [];
  let page = 1;
  while (true) {
    const url = `${baseUrl}${WP_API}/${type}?per_page=100&page=${page}&${FIELDS}`;
    let batch;
    try { batch = await fetchJson(url); } catch { break; }
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return items;
}

async function crawlSite(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");
  const types = typesOpt.split(",").map((t) => t.trim()).filter(Boolean);

  // Fetch item lists from WP REST API
  log(`\n${c.bold}${c.cyan}══ Site crawl: ${base} ══${c.reset}`);
  let allItems = [];
  for (const type of types) {
    log(`  Fetching ${type} list…`);
    const items = await wpFetchAll(base, type);
    log(`  Found ${items.length} ${type}`);
    allItems.push(...items);
  }

  // Filter: published only, optionally top-level only
  const published = allItems.filter((i) => i.status === "publish");
  const toAudit = allPages
    ? published
    : published.filter((i) => !i.parent || i.parent === 0);

  log(`  ${toAudit.length} pages to audit (${allPages ? "all" : "top-level only"})`);

  // Fetch rendered HTML for each page in parallel
  const pageReports = await pool(toAudit, concurrency, async (item) => {
    const url = item.link;
    const slug = item.slug || String(item.id);
    try {
      log(`  ${c.dim}→ ${url}${c.reset}`);
      const html = await fetchText(url);
      const report = auditPage(html, url);
      return {
        id: item.id,
        slug,
        type: item.type,
        title: item.title?.rendered ?? slug,
        url,
        parent: item.parent ?? 0,
        modifiedAt: item.date_modified,
        ...report,
      };
    } catch (err) {
      warn(`Failed to fetch ${url}: ${err.message}`);
      return { id: item.id, slug, type: item.type, title: item.title?.rendered ?? slug, url, error: err.message };
    }
  });

  // Collect all unique stylesheet URLs across all pages
  const seenStylesheets = new Map(); // url → css
  const allStylesheetUrls = [...new Set(
    pageReports.flatMap((p) => p.stylesheets ?? [])
  )];
  log(`\n  Fetching ${allStylesheetUrls.length} unique stylesheet(s)…`);
  const fetchedSheets = await pool(allStylesheetUrls, concurrency, async (href) => {
    try {
      const css = await fetchText(href);
      seenStylesheets.set(href, css);
      tick(href.slice(0, 80));
      return { source: href, css };
    } catch {
      warn(`CSS fetch failed: ${href}`);
      return null;
    }
  });
  const validSheets = fetchedSheets.filter(Boolean);

  // Run full CSS audit on all collected stylesheets
  const cssReport = auditCss(validSheets);

  // Aggregate class frequency across all pages
  const classFreq = {};
  for (const p of pageReports) {
    for (const cls of p.cssClasses ?? [])
      classFreq[cls] = (classFreq[cls] ?? 0) + 1;
  }
  const topClasses = Object.entries(classFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([cls, n]) => ({ cls, pages: n }));

  // Block inventory — aggregated from flat block lists, with variant info
  const blockFreq = {};   // block → { pages: Set, variant }
  for (const p of pageReports) {
    for (const b of p.blocks ?? []) {
      if (!blockFreq[b.block]) blockFreq[b.block] = { pages: new Set(), variant: b.variant };
      blockFreq[b.block].pages.add(p.url);
    }
  }

  // Cross-page issues
  const ok = pageReports.filter((p) => !p.error);
  const issues = {
    pagesWithShortcodes:     ok.filter((p) => p.shortcodes?.length).map((p) => ({ url: p.url, shortcodes: p.shortcodes })),
    pagesMissingDescription: ok.filter((p) => !p.seo?.description).map((p) => p.url),
    pagesMissingOgImage:     ok.filter((p) => !p.seo?.ogImage).map((p) => p.url),
    pagesMissingTitle:       ok.filter((p) => !p.seo?.title).map((p) => p.url),
    pagesWithInlineStyles:   ok.filter((p) => (p.inlineStyleBytes ?? 0) > 0).map((p) => ({ url: p.url, bytes: p.inlineStyleBytes })),
    pagesWithImagesNoAlt:    ok.filter((p) => p.images?.missingAlt > 0).map((p) => ({ url: p.url, count: p.images.missingAlt })),
    errors:                  pageReports.filter((p) => p.error).map((p) => ({ url: p.url, error: p.error })),
  };

  return {
    mode: "site",
    baseUrl: base,
    crawledAt: new Date().toISOString(),
    typesAudited: types,
    topLevelOnly: !allPages,
    totals: {
      pages:         pageReports.length,
      errors:        issues.errors.length,
      images:        ok.reduce((s, p) => s + (p.images?.total ?? 0), 0),
      imagesLazy:    ok.reduce((s, p) => s + (p.images?.lazy ?? 0), 0),
      imagesMissingAlt: ok.reduce((s, p) => s + (p.images?.missingAlt ?? 0), 0),
      internalLinks: ok.reduce((s, p) => s + (p.links?.internal ?? 0), 0),
      externalLinks: ok.reduce((s, p) => s + (p.links?.external ?? 0), 0),
      wordsTotal:    ok.reduce((s, p) => s + (p.wordCount ?? 0), 0),
    },
    stylesheets: allStylesheetUrls,
    css: cssReport,
    topClasses,
    blockInventory: Object.entries(blockFreq)
      .sort(([, a], [, b]) => b.pages.size - a.pages.size)
      .map(([block, { pages, variant }]) => ({ block, variant, pages: pages.size })),
    crossPageIssues: issues,
    pages: pageReports,
  };
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtSingle(r) {
  const lines = [];
  const h1 = (t) => `\n${c.bold}${c.cyan}══ ${t} ══${c.reset}`;
  const h2 = (t) => `\n${c.bold}${c.blue}── ${t}${c.reset}`;
  const ok   = (t) => `  ${c.green}✓${c.reset} ${t}`;
  const wn   = (t) => `  ${c.yellow}⚠${c.reset}  ${t}`;
  const er   = (t) => `  ${c.red}✗${c.reset} ${t}`;
  const dim  = (t) => `  ${c.dim}${t}${c.reset}`;

  lines.push(h1("Visual Audit — Single Page"));
  lines.push(dim(`Source : ${r.source}`));
  lines.push(dim(`Audited: ${r.auditedAt}`));

  // SEO
  lines.push(h2("SEO"));
  const s = r.page.seo;
  if (s.title)       lines.push(ok(`Title: ${s.title}`));             else lines.push(wn("No <title>"));
  if (s.description) lines.push(ok(`Description: ${s.description}`)); else lines.push(wn("No meta description"));
  if (s.ogImage)     lines.push(ok(`OG image: ${s.ogImage}`));        else lines.push(wn("No og:image"));
  if (s.canonical)   lines.push(dim(`Canonical: ${s.canonical}`));
  if (s.hasSchema)   lines.push(ok("Schema.org JSON-LD found"));

  // CSS Sources
  lines.push(h2("CSS Sources"));
  if (!r.css.sources.length) lines.push(wn("No CSS sources found"));
  for (const src of r.css.sources)
    lines.push(dim(`${src.source.slice(0, 76).padEnd(76)} ${(src.bytes / 1024).toFixed(1)} KB`));

  // Design tokens
  lines.push(h2("Design Tokens"));
  const vars = Object.entries(r.css.design.cssVariables);
  if (!vars.length) { lines.push(wn("No CSS custom properties")); }
  else {
    lines.push(ok(`${vars.length} CSS variables`));
    for (const [k, v] of vars) lines.push(dim(`  ${k.padEnd(38)} ${v}`));
  }

  // Colors, fonts, dark mode
  lines.push(h2("Colors & Typography"));
  lines.push(dim(`${r.css.design.colorCount} unique color values`));
  lines.push(dim(r.css.design.colors.slice(0, 16).join("  ")));
  if (r.css.design.fonts.length) lines.push(ok("Fonts: " + r.css.design.fonts.join(", ")));
  if (r.css.design.darkModeStrategy !== "none detected") lines.push(ok(`Dark mode: ${r.css.design.darkModeStrategy}`));
  else lines.push(wn("No dark mode strategy"));

  // Transitions
  if (r.css.design.transitions.length)
    lines.push(ok("Transitions: " + r.css.design.transitions.join(" | ")));
  else lines.push(wn("No transition declarations"));

  // Responsive
  lines.push(h2("Responsive"));
  if (r.css.responsive.mediaQueries.length)
    for (const q of r.css.responsive.mediaQueries) lines.push(ok(q));
  else lines.push(wn("No @media queries"));

  // Interactivity
  lines.push(h2("Interactive States"));
  lines.push(ok(`${r.css.interactivity.hoverSelectors.length} :hover`));
  lines.push(ok(`${r.css.interactivity.focusSelectors.length} :focus`));
  lines.push(ok(`${r.css.interactivity.focusVisibleSelectors.length} :focus-visible`));
  lines.push(ok(`${r.css.interactivity.disabledSelectors.length} :disabled`));
  lines.push(ok(`${r.css.interactivity.activeSelectors.length} :active`));
  if (r.css.gaps.missingFocusStates.length)
    for (const g of r.css.gaps.missingFocusStates)
      lines.push(wn(`"${g.base}" has :hover but missing focus`));
  else lines.push(ok("All hover selectors have a focus counterpart"));

  // Page structure
  lines.push(h2("Page Structure (Semantic Regions)"));
  if (r.page.pageStructure.length) {
    for (const reg of r.page.pageStructure) {
      const cls = reg.classes.length ? `.${reg.classes.slice(0, 3).join(".")}` : "";
      const id  = reg.id ? `#${reg.id}` : "";
      lines.push(dim(`  <${reg.tag}${id}${cls}>${reg.role ? `  [role=${reg.role}]` : ""}`));
    }
  } else {
    lines.push(wn("No semantic HTML5 landmark elements found"));
  }

  // Heading outline
  lines.push(h2("Heading Outline"));
  if (r.page.headingOutline.length) {
    for (const h of r.page.headingOutline)
      lines.push(dim(`${"  ".repeat(h.level - 1)}h${h.level} ${h.text}`));
  } else {
    lines.push(wn("No headings found"));
  }

  // Block tree
  lines.push(h2("WP Block Tree"));
  if (r.page.blockTree.length) {
    function printTree(nodes, depth) {
      for (const node of nodes) {
        const indent = "  ".repeat(depth);
        const attrsStr = Object.keys(node.attrs).length
          ? ` ${c.dim}${JSON.stringify(node.attrs).slice(0, 60)}${c.reset}`
          : "";
        lines.push(`  ${indent}${c.green}${node.block}${c.reset}${attrsStr}`);
        if (node.children?.length) printTree(node.children, depth + 1);
      }
    }
    printTree(r.page.blockTree, 0);
  } else {
    lines.push(dim("  (no WP block comments found — may be classic editor or static HTML)"));
  }

  // Forms
  if (r.page.forms.length) {
    lines.push(h2("Forms"));
    for (const f of r.page.forms) {
      const id = f.id ? `#${f.id}` : "(no id)";
      lines.push(dim(`  <form ${id}  method=${f.method}  action=${f.action || "(none)"}>`));
      for (const field of f.fields)
        lines.push(dim(`    ${field.type.padEnd(10)} name="${field.name}"${field.label ? `  label="${field.label}"` : ""}`));
      if (f.submits.length) lines.push(dim(`    [submit] ${f.submits.join(", ")}`));
    }
  }

  // Shortcodes
  if (r.page.shortcodes.length) { lines.push(h2("Shortcodes (unrendered)")); for (const s of r.page.shortcodes) lines.push(wn(s)); }

  // Images
  lines.push(h2("Images"));
  const img = r.page.images;
  lines.push(dim(`Total: ${img.total}  Lazy: ${img.lazy}  Missing alt: ${img.missingAlt}  External: ${img.external}`));

  // A11y
  lines.push(h2("Accessibility"));
  if (!r.page.a11y.length) lines.push(ok("No obvious issues"));
  else for (const i of r.page.a11y) lines.push(er(i));

  // HTML metrics
  lines.push(h2("HTML Metrics"));
  for (const [k, v] of Object.entries(r.htmlMetrics)) lines.push(dim(`  ${k.padEnd(12)} ${v}`));

  lines.push("\n");
  return lines.join("\n");
}

function fmtSite(r) {
  const lines = [];
  const h1 = (t) => `\n${c.bold}${c.cyan}══ ${t} ══${c.reset}`;
  const h2 = (t) => `\n${c.bold}${c.blue}── ${t}${c.reset}`;
  const ok   = (t) => `  ${c.green}✓${c.reset} ${t}`;
  const wn   = (t) => `  ${c.yellow}⚠${c.reset}  ${t}`;
  const er   = (t) => `  ${c.red}✗${c.reset} ${t}`;
  const dim  = (t) => `  ${c.dim}${t}${c.reset}`;

  lines.push(h1(`Site Audit — ${r.baseUrl}`));
  lines.push(dim(`Crawled: ${r.crawledAt}`));
  lines.push(dim(`Types:   ${r.typesAudited.join(", ")}`));
  lines.push(dim(`Scope:   ${r.topLevelOnly ? "top-level pages only" : "all pages"}`));

  // Totals
  lines.push(h2("Totals"));
  lines.push(dim(`Pages audited   ${r.totals.pages}  (errors: ${r.totals.errors})`));
  lines.push(dim(`Images          ${r.totals.images}  (lazy: ${r.totals.imagesLazy}, missing alt: ${r.totals.imagesMissingAlt})`));
  lines.push(dim(`Links           internal: ${r.totals.internalLinks}  external: ${r.totals.externalLinks}`));
  lines.push(dim(`Total words     ~${r.totals.wordsTotal.toLocaleString()}`));

  // Per-page table
  lines.push(h2("Pages"));
  const col = (s, w) => String(s ?? "").slice(0, w).padEnd(w);
  lines.push(dim(`${"#".padEnd(4)} ${"Type".padEnd(6)} ${"Slug".padEnd(30)} ${"Title".padEnd(40)} Img  Alt  Words`));
  lines.push(dim("─".repeat(96)));
  for (const p of r.pages) {
    if (p.error) {
      lines.push(`  ${c.red}✗${c.reset} ${dim(col(p.slug, 30))} ERROR: ${p.error}`);
      continue;
    }
    const img  = p.images?.total ?? 0;
    const noAlt = p.images?.missingAlt ?? 0;
    const words = p.wordCount ?? 0;
    const flags = [
      p.shortcodes?.length  ? `${c.yellow}[SC]${c.reset}` : "",
      noAlt > 0             ? `${c.yellow}[ALT]${c.reset}` : "",
      !p.seo?.description   ? `${c.yellow}[DSC]${c.reset}` : "",
    ].filter(Boolean).join(" ");
    lines.push(`  ${c.dim}${col(r.pages.indexOf(p) + 1, 3)}${c.reset} ${col(p.type, 6)} ${col(p.slug, 30)} ${col(p.seo?.title || p.title, 40)} ${String(img).padStart(3)}  ${String(noAlt).padStart(3)}  ${String(words).padStart(5)}  ${flags}`);
  }

  // Cross-page issues
  lines.push(h2("Cross-Page Issues"));
  const ci = r.crossPageIssues;
  if (ci.pagesWithShortcodes.length)   lines.push(wn(`${ci.pagesWithShortcodes.length} page(s) with unrendered shortcodes`));
  else                                 lines.push(ok("No unrendered shortcodes"));
  if (ci.pagesWithImagesNoAlt.length)  lines.push(wn(`${ci.pagesWithImagesNoAlt.length} page(s) with images missing alt text`));
  else                                 lines.push(ok("All images have alt text"));
  if (ci.pagesMissingDescription.length) lines.push(wn(`${ci.pagesMissingDescription.length} page(s) missing meta description`));
  else                                 lines.push(ok("All pages have meta description"));
  if (ci.pagesMissingOgImage.length)   lines.push(wn(`${ci.pagesMissingOgImage.length} page(s) missing og:image`));
  else                                 lines.push(ok("All pages have og:image"));
  if (ci.pagesWithInlineStyles.length) lines.push(wn(`${ci.pagesWithInlineStyles.length} page(s) have inline <style> blocks`));
  if (ci.errors.length)               lines.push(er(`${ci.errors.length} fetch error(s)`));

  // Block inventory — grouped by variant
  lines.push(h2("Block Inventory (across all pages)"));
  const variantColour = {
    "core":        c.dim,
    "kadence":     c.green,
    "kadence-pro": c.magenta,
    "plugin":      c.yellow,
  };
  const variantLabel = { "core": "core", "kadence": "kadence", "kadence-pro": "kadence PRO", "plugin": "plugin" };
  // Print header
  lines.push(dim(`  ${"Block".padEnd(48)} ${"Type".padEnd(14)} Pages`));
  lines.push(dim(`  ${"─".repeat(70)}`));
  for (const { block, variant, pages } of r.blockInventory) {
    const vc = variantColour[variant] ?? c.dim;
    const vl = (variantLabel[variant] ?? variant).padEnd(12);
    lines.push(`  ${vc}${block.padEnd(48)}${c.reset} ${c.dim}${vl}${c.reset}  ${pages}`);
  }

  // Top CSS classes
  lines.push(h2("Top 20 CSS Classes"));
  for (const { cls, pages } of r.topClasses.slice(0, 20))
    lines.push(dim(`  ${cls.padEnd(48)} ${pages} page(s)`));

  // Stylesheets
  lines.push(h2("Stylesheets found"));
  for (const s of r.stylesheets) lines.push(dim(`  ${s}`));

  // CSS audit
  lines.push(h2("CSS — Design Tokens"));
  const vars = Object.entries(r.css.design.cssVariables);
  if (!vars.length) lines.push(wn("No CSS custom properties found"));
  else {
    lines.push(ok(`${vars.length} variables`));
    for (const [k, v] of vars) lines.push(dim(`  ${k.padEnd(38)} ${v}`));
  }

  lines.push(h2("CSS — Responsive"));
  if (!r.css.responsive.mediaQueries.length) lines.push(wn("No @media queries"));
  else for (const q of r.css.responsive.mediaQueries) lines.push(ok(q));

  lines.push(h2("CSS — Interactive States"));
  lines.push(ok(`${r.css.interactivity.hoverSelectors.length} :hover`));
  lines.push(ok(`${r.css.interactivity.focusVisibleSelectors.length} :focus-visible`));
  lines.push(ok(`${r.css.interactivity.disabledSelectors.length} :disabled`));
  if (r.css.gaps.missingFocusStates.length)
    for (const g of r.css.gaps.missingFocusStates)
      lines.push(wn(`"${g.base}" has :hover but no focus state`));
  else lines.push(ok("All hover selectors have a focus counterpart"));

  lines.push("\n");
  return lines.join("\n");
}

// ── Entry ─────────────────────────────────────────────────────────────────────

try {
  const report = siteMode ? await crawlSite(siteMode) : await auditSingle(target);
  const jsonOut = JSON.stringify(report, null, 2);

  if (outArg) {
    await fs.writeFile(path.resolve(outArg), `${jsonOut}\n`, "utf8");
    log(`\nReport saved → ${outArg}`);
  }

  if (jsonOnly) {
    process.stdout.write(`${jsonOut}\n`);
  } else {
    const text = report.mode === "site" ? fmtSite(report) : fmtSingle(report);
    console.log(text);
    if (!outArg) log(`Tip: add --out report.json to save full data`);
  }
} catch (err) {
  console.error(`\x1b[31mAudit failed:\x1b[0m ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}
