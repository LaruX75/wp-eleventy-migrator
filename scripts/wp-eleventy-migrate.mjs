#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import http from "node:http";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_TYPES = ["posts", "pages"];
const DEFAULT_NAMESPACE = "/wp-json/wp/v2";
const DEFAULT_DATA_DIR = "_data";
const DEFAULT_KADENCE_BLOCKS_DIR = "_includes/blocks/kadence";
const DEFAULT_STYLES_DIR = "styles/legacy";
const DEFAULT_KADENCE_STYLES_DIR = "styles/kadence-legacy";
const DEFAULT_KADENCE_PRO_STYLES_DIR = "styles/kadence-pro-legacy";
const SUPPORTED_KADENCE_BLOCKS = [
  "advancedheading",
  "advancedbtn",
  "rowlayout",
  "column",
  "image",
  "gallery",
  "tabs",
  "tab",
  "accordion",
  "pane",
  "infobox",
  "icon",
  "iconlist",
  "listitem",
  "spacer",
  "testimonials",
  "testimonial",
  "form"
];
// Maps each block shortName to:
//   wrap  — Kadence's own kb-* wrapper class (what site CSS targets most)
//   uid   — CSS class prefix for uniqueID-scoped rules, e.g. kb-row-layout-id_<id>
// wp-block-kadence-{name} is always added (WordPress block class convention).
const KADENCE_BLOCK_CSS = {
  advancedheading:      { wrap: "kb-adv-heading",           uid: "kt-adv-heading" },
  advancedbtn:          { wrap: "kb-btn-align-wrap" },
  rowlayout:            { wrap: "kb-row-layout-wrap",        uid: "kb-row-layout-id" },
  column:               { wrap: "kb-section-container",     uid: "kb-section" },
  image:                { wrap: "kb-image-wrap" },
  gallery:              { wrap: "kb-gallery-wrap",           uid: "kb-gallery-id" },
  tabs:                 { wrap: "kb-tabs",                   uid: "kb-tabs-id" },
  tab:                  { wrap: "kb-tab-panel" },
  accordion:            { wrap: "kb-accordion",              uid: "kb-accordion-id" },
  pane:                 { wrap: "kb-accordion-pane" },
  infobox:              { wrap: "kt-blocks-info-box-wrap",   uid: "kt-info-box" },
  icon:                 { wrap: "kb-svg-icon-wrap" },
  iconlist:             { wrap: "kb-icon-list",              uid: "kb-icon-list-id" },
  listitem:             { wrap: "kb-icon-list-item" },
  spacer:               { wrap: "kt-block-spacer",           uid: "kt-block-spacer-id" },
  testimonials:         { wrap: "kb-testimonial-wrap",       uid: "kb-testimonial-id" },
  testimonial:          { wrap: "kb-testimonial-bg-wrap" },
  form:                 { wrap: "kb-form",                   uid: "kb-form-id" },
  countdown:            { wrap: "kb-countdown-wrap",         uid: "kb-countdown-id" },
  videopopup:           { wrap: "kb-video-pop-wrap" },
  lottie:               { wrap: "kb-lottie-wrap" },
  modal:                { wrap: "kb-modal-wrap",             uid: "kb-modal-id" },
  navigation:           { wrap: "kb-navigation",             uid: "kb-navigation-id" },
  "off-canvas":         { wrap: "kb-off-canvas-wrap" },
  "show-more":          { wrap: "kb-show-more-wrap" },
  dynamichtml:          { wrap: "kb-dynamic-html" },
  identity:             { wrap: "kb-identity" },
  contentwidget:        { wrap: "kb-widget-area" },
  splitcontent:         { wrap: "kb-split-content" },
  "table-of-contents":  { wrap: "kb-toc-wrap",               uid: "kb-toc-id" },
  postcarousel:         { wrap: "kb-post-carousel",          uid: "kb-post-carousel-id" },
  portfoliogrid:        { wrap: "kb-portfolio-grid" }
};

const SUPPORTED_KADENCE_PRO_BLOCKS = [
  "countdown",
  "videopopup",
  "lottie",
  "modal",
  "navigation",
  "off-canvas",
  "show-more",
  "dynamichtml",
  "identity",
  "contentwidget",
  "splitcontent",
  "table-of-contents",
  "postcarousel",
  "portfoliogrid"
];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_ROOT = path.resolve(__dirname, "../ui");

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function decodeHtml(str) {
  if (!str) return "";
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, code) => {
    if (code[0] === "#") {
      const hex = code[1]?.toLowerCase() === "x";
      const raw = hex ? code.slice(2) : code.slice(1);
      const v = Number.parseInt(raw, hex ? 16 : 10);
      return Number.isNaN(v) ? full : String.fromCodePoint(v);
    }
    return Object.prototype.hasOwnProperty.call(named, code) ? named[code] : full;
  });
}

function stripHtml(html) {
  return decodeHtml(String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function slugify(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "entry";
}

function toIsoDay(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "1970-01-01";
  return d.toISOString().slice(0, 10);
}

function yamlValue(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `\n${value.map((v) => `${pad}- ${yamlValue(v, indent + 2)}`).join("\n")}`;
  }
  const s = String(value);
  if (s.includes("\n")) {
    const lines = s.split("\n").map((l) => `${pad}  ${l}`);
    return `|-\n${lines.join("\n")}`;
  }
  if (/[:#{}\[\],&*!?|><=%@`]/.test(s) || s.trim() !== s || s === "" || s === "null" || s === "true" || s === "false") {
    return JSON.stringify(s);
  }
  return s;
}

function toFrontMatter(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    const rendered = yamlValue(v, 2);
    if (rendered.startsWith("\n")) lines.push(`${k}:${rendered}`);
    else lines.push(`${k}: ${rendered}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

function basicHtmlToMarkdown(html) {
  let out = String(html || "");
  out = out.replace(/\r\n/g, "\n");
  out = out.replace(/<h1[^>]*>(.*?)<\/h1>/gis, "# $1\n\n");
  out = out.replace(/<h2[^>]*>(.*?)<\/h2>/gis, "## $1\n\n");
  out = out.replace(/<h3[^>]*>(.*?)<\/h3>/gis, "### $1\n\n");
  out = out.replace(/<h4[^>]*>(.*?)<\/h4>/gis, "#### $1\n\n");
  out = out.replace(/<h5[^>]*>(.*?)<\/h5>/gis, "##### $1\n\n");
  out = out.replace(/<h6[^>]*>(.*?)<\/h6>/gis, "###### $1\n\n");
  out = out.replace(/<strong[^>]*>(.*?)<\/strong>/gis, "**$1**");
  out = out.replace(/<em[^>]*>(.*?)<\/em>/gis, "*$1*");
  out = out.replace(/<a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)<\/a>/gis, "[$2]($1)");
  out = out.replace(/<img[^>]*src=\"([^\"]+)\"[^>]*alt=\"([^\"]*)\"[^>]*>/gis, "![$2]($1)");
  out = out.replace(/<img[^>]*src=\"([^\"]+)\"[^>]*>/gis, "![]($1)");
  out = out.replace(/<li[^>]*>(.*?)<\/li>/gis, "- $1\n");
  out = out.replace(/<\/?(ul|ol)[^>]*>/gis, "\n");
  out = out.replace(/<br\s*\/?>/gis, "\n");
  out = out.replace(/<p[^>]*>(.*?)<\/p>/gis, "$1\n\n");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeHtml(out);
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function joinUrl(base, p) {
  return `${base.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

function parseCsvList(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function ask(rl, question, fallback = "") {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback;
}

async function askYesNo(rl, question, fallback = true) {
  const hint = fallback ? "Y/n" : "y/N";
  const raw = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "y" || raw === "yes";
}

function printStep(step, text) {
  output.write(`\n[${step}] ${text}\n`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchAllPages(url, headers = {}) {
  const all = [];
  let page = 1;
  while (true) {
    const finalUrl = `${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`;
    const res = await fetch(finalUrl, { headers });
    if (!res.ok) {
      if (res.status === 400 && page > 1) break;
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} for ${finalUrl}\n${body.slice(0, 300)}`);
    }
    const part = await res.json();
    if (!Array.isArray(part) || part.length === 0) break;
    all.push(...part);
    const totalPages = Number(res.headers.get("x-wp-totalpages") || "0");
    if (totalPages > 0 && page >= totalPages) break;
    page += 1;
  }
  return all;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

function extractMediaUrls(html, wpBaseUrl) {
  const urls = new Set();
  const source = String(html || "");
  const addUrl = (u) => {
    if (!u) return;
    if (u.startsWith("http://") || u.startsWith("https://")) {
      if (!wpBaseUrl || u.startsWith(wpBaseUrl)) urls.add(u);
    }
  };
  for (const m of source.matchAll(/\bsrc=["']([^"']+)["']/gi)) addUrl(m[1]);
  for (const m of source.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    for (const part of m[1].split(",")) addUrl(part.trim().split(/\s+/)[0]);
  }
  // Lazy-loaded images: data-src, data-lazy-src, data-original, data-lazy
  for (const m of source.matchAll(/\bdata-(?:src|lazy-src|original|lazy)=["']([^"']+)["']/gi)) addUrl(m[1]);
  for (const m of source.matchAll(/\bdata-srcset=["']([^"']+)["']/gi)) {
    for (const part of m[1].split(",")) addUrl(part.trim().split(/\s+/)[0]);
  }
  return [...urls];
}

function sanitizeFileSegment(v) {
  return String(v || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function menuItemLabel(item) {
  return decodeHtml(item?.title?.rendered || item?.title || item?.label || item?.name || "");
}

function menuItemUrl(item) {
  return item?.url || item?.link || item?.href || "";
}

function menuItemParent(item) {
  return item?.parent ?? item?.parent_id ?? item?.menu_item_parent ?? 0;
}

function menuItemOrder(item) {
  return item?.menu_order ?? item?.order ?? item?.position ?? 0;
}

function normalizeMenuItems(items = []) {
  return items.map((item) => ({
    id: item?.id ?? item?.ID ?? `${menuItemOrder(item)}-${slugify(menuItemLabel(item))}`,
    parent: menuItemParent(item),
    title: menuItemLabel(item),
    url: menuItemUrl(item),
    type: item?.type || item?.object || "",
    object: item?.object || "",
    objectId: item?.object_id || item?.objectId || "",
    classes: Array.isArray(item?.classes) ? item.classes.filter(Boolean) : [],
    target: item?.target || "",
    rel: item?.xfn || item?.rel || "",
    description: decodeHtml(item?.description || ""),
    order: menuItemOrder(item),
    // Kadence megamenu meta (available when fetched with context=edit)
    megamenu:        !!(item?.meta?._kad_menu_item_megamenu || item?.meta?.kad_menu_item_megamenu),
    megamenuColumns: item?.meta?._kad_menu_item_columns  ?? item?.meta?.kad_menu_item_columns  ?? [],
    megamenuRows:    item?.meta?._kad_menu_item_rows     ?? item?.meta?.kad_menu_item_rows     ?? [],
    megamenuStyle:   item?.meta?._kad_menu_item_style    ?? item?.meta?.kad_menu_item_style    ?? {},
    megamenuWidth:   item?.meta?._kad_menu_item_mega_width ?? "",
    megamenuBackground: item?.meta?._kad_menu_item_mega_background ?? {},
  })).filter((item) => item.title || item.url);
}

function buildMenuTree(items = []) {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const byId = new Map();
  for (const item of sorted) byId.set(item.id, { ...item, children: [] });

  const roots = [];
  for (const item of sorted) {
    const node = byId.get(item.id);
    const parentId = item.parent;
    if (parentId && byId.has(parentId)) byId.get(parentId).children.push(node);
    else roots.push(node);
  }
  return roots;
}

function normalizeMenuRecord(menu, items) {
  const title = decodeHtml(menu?.name || menu?.title?.rendered || menu?.title || menu?.slug || "menu");
  const slug = slugify(menu?.slug || menu?.name || menu?.title?.rendered || menu?.title || "menu");
  const normalizedItems = normalizeMenuItems(items);
  return {
    id: menu?.id || slug,
    slug,
    title,
    location: menu?.location || menu?.theme_location || "",
    items: buildMenuTree(normalizedItems)
  };
}

async function tryFetchMenusFromMenusV1(wpBaseUrl, headers) {
  const listUrl = joinUrl(wpBaseUrl, "/wp-json/menus/v1/menus");
  const menus = await fetchJson(listUrl, headers);
  if (!Array.isArray(menus) || menus.length === 0) return [];

  const resolved = [];
  for (const menu of menus) {
    const detailUrl = joinUrl(wpBaseUrl, `/wp-json/menus/v1/menus/${menu.id}`);
    const detail = await fetchJson(detailUrl, headers);
    const items = Array.isArray(detail?.items) ? detail.items : [];
    resolved.push(normalizeMenuRecord(detail, items));
  }
  return resolved;
}

async function tryFetchMenusFromWpApiMenusV2(wpBaseUrl, headers) {
  const listUrl = joinUrl(wpBaseUrl, "/wp-json/wp-api-menus/v2/menus");
  const menus = await fetchJson(listUrl, headers);
  const menuList = Array.isArray(menus) ? menus : Array.isArray(menus?.menus) ? menus.menus : [];
  if (!menuList.length) return [];

  const resolved = [];
  for (const menu of menuList) {
    const items = Array.isArray(menu?.items) ? menu.items : [];
    if (items.length) {
      resolved.push(normalizeMenuRecord(menu, items));
      continue;
    }
    const detailUrl = joinUrl(wpBaseUrl, `/wp-json/wp-api-menus/v2/menus/${menu.id}`);
    const detail = await fetchJson(detailUrl, headers);
    resolved.push(normalizeMenuRecord(detail, Array.isArray(detail?.items) ? detail.items : []));
  }
  return resolved;
}

async function tryFetchMenusFromWpV2(wpBaseUrl, headers) {
  const menusUrl = joinUrl(wpBaseUrl, "/wp-json/wp/v2/menus");
  const itemsUrl = joinUrl(wpBaseUrl, "/wp-json/wp/v2/menu-items?context=edit");
  const [menus, items] = await Promise.all([
    fetchAllPages(menusUrl, headers),
    fetchAllPages(itemsUrl, headers)
  ]);
  if (!Array.isArray(menus) || !menus.length || !Array.isArray(items) || !items.length) return [];

  return menus.map((menu) => {
    const menuId = menu?.id;
    const menuItems = items.filter((item) => (item?.menus || []).includes(menuId) || item?.menus === menuId || item?.menu === menuId);
    return normalizeMenuRecord(menu, menuItems);
  }).filter((menu) => menu.items.length > 0);
}

async function fetchMenus(wpBaseUrl, headers = {}, warnings = []) {
  const attempts = [
    { name: "menus/v1", run: () => tryFetchMenusFromMenusV1(wpBaseUrl, headers) },
    { name: "wp-api-menus/v2", run: () => tryFetchMenusFromWpApiMenusV2(wpBaseUrl, headers) },
    { name: "wp/v2 menus", run: () => tryFetchMenusFromWpV2(wpBaseUrl, headers) }
  ];

  for (const attempt of attempts) {
    try {
      const menus = await attempt.run();
      if (menus.length) return { source: attempt.name, menus };
    } catch (err) {
      warnings.push(`Menu fetch via ${attempt.name} failed: ${String(err.message || err)}`);
    }
  }
  return { source: "", menus: [] };
}

async function downloadFile(url, outPath, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed media download: ${res.status} ${url}`);
  const arr = new Uint8Array(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, arr);
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${body.slice(0, 300)}`);
  }
  return res.text();
}

function extractStylesheetUrls(html, baseUrl) {
  const urls = new Set();
  for (const match of String(html || "").matchAll(/<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      urls.add(new URL(match[1], baseUrl).toString());
    } catch {
      // ignore malformed URLs
    }
  }
  return [...urls];
}

function extractCssVariables(css) {
  const vars = {};
  for (const match of String(css || "").matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;}{]+);/g)) {
    const [, name, value] = match;
    if (!vars[name]) vars[name] = value.trim();
  }
  return vars;
}

function extractCssImports(css, baseUrl) {
  const urls = [];
  for (const match of String(css || "").matchAll(/@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])/gi)) {
    const rel = (match[1] || match[2] || "").trim();
    if (!rel) continue;
    try { urls.push(new URL(rel, baseUrl).toString()); } catch {}
  }
  return urls;
}

function extractCssMediaUrls(css, baseUrl) {
  const urls = new Set();
  for (const match of String(css || "").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const rel = match[1].trim();
    if (!rel || rel.startsWith("data:") || rel.startsWith("#")) continue;
    try { urls.add(new URL(rel, baseUrl).toString()); } catch {}
  }
  return [...urls];
}

function extractInlineStyles(html) {
  const styles = [];
  for (const match of String(html || "").matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const content = match[1].trim();
    if (content) styles.push(content);
  }
  return styles;
}

// Common words that look like shortcodes but aren't — Finnish, English, JS artifacts
const SHORTCODE_BLOCKLIST = new Set([
  "ei","on","ja","tai","se","ne","he","me","te","no","ok","id","em","en",
  "object","class","style","type","href","src","alt","rel","div","span",
  "a","b","i","p","s","u","br","hr","li","ul","ol","tr","td","th",
  "if","else","for","do","in","is","as","at","or","of","to","by","an",
  "the","and","not","but","was","are","has","had","its","via",
  "luovat","luova","hyvä","hyvät","uusi","uudet","uutta",
]);

function detectShortcodes(content) {
  const found = new Set();
  for (const m of String(content || "").matchAll(/\[([a-z_][a-z0-9_-]*)(?:\s[^\]]*)?]/gi)) {
    const name = m[1].toLowerCase();
    // Must be at least 3 chars, not a blocked word, and either contain _ / - or be ≥5 chars
    if (name.length < 3) continue;
    if (SHORTCODE_BLOCKLIST.has(name)) continue;
    if (name.length < 5 && !name.includes("_") && !name.includes("-")) continue;
    found.add(m[1]);
  }
  return [...found];
}

function rewriteCssUrls(css, wpOrigin, mediaPathPrefix) {
  return String(css || "").replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, rawUrl) => {
    const url = rawUrl.trim();
    if (url.startsWith("data:") || url.startsWith("#")) return match;
    try {
      const absolute = new URL(url, wpOrigin).toString();
      if (absolute.startsWith(wpOrigin)) {
        const pathname = new URL(absolute).pathname;
        return `url("${mediaPathPrefix}${pathname}")`;
      }
    } catch {}
    return match;
  });
}

/**
 * Parse megamenu structure from rendered page HTML.
 * Used as a fallback when REST API does not return Kadence menu meta.
 * Returns an array of top-level nav items, each with children and megamenu info.
 */
function extractNavFromHtml(html, baseUrl) {
  const navs = [];
  // Find all <nav> elements (Kadence navigation has class kb-navigation or wp-block-kadence-navigation)
  for (const navMatch of html.matchAll(/<nav([^>]*)>([\s\S]*?)<\/nav>/gi)) {
    const navAttrs = navMatch[1];
    const navBody  = navMatch[2];
    const navId      = navAttrs.match(/\bid=["']([^"']+)["']/i)?.[1] ?? "";
    const navClasses = (navAttrs.match(/class=["']([^"']+)["']/i)?.[1] ?? "").split(/\s+/).filter(Boolean);
    const ariaLabel  = navAttrs.match(/aria-label=["']([^"']+)["']/i)?.[1] ?? "";

    // Find top-level <li> items
    const items = [];
    // Match <li> elements (non-greedy, handles nesting crudely via depth tracking)
    for (const liMatch of navBody.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/gi)) {
      const liAttrs = liMatch[1];
      const liBody  = liMatch[2];
      const liClasses = (liAttrs.match(/class=["']([^"']+)["']/i)?.[1] ?? "").split(/\s+/).filter(Boolean);
      const isMega  = liClasses.some((c) => c.includes("mega") || c.includes("kadence-menu-mega"));

      // Extract anchor
      const aMatch = liBody.match(/<a([^>]*)>([^<]*)<\/a>/i);
      if (!aMatch) continue;
      const aAttrs = aMatch[1];
      const title  = aMatch[2].trim();
      const href   = aAttrs.match(/href=["']([^"']+)["']/i)?.[1] ?? "";
      let url = href;
      try { url = new URL(href, baseUrl).href; } catch { /* keep as-is */ }

      // Extract submenu children
      const children = [];
      for (const subLi of liBody.matchAll(/<li[^>]*>[\s\S]*?<a([^>]*)>([^<]*)<\/a>/gi)) {
        const subHref  = subLi[1].match(/href=["']([^"']+)["']/i)?.[1] ?? "";
        const subTitle = subLi[2].trim();
        if (subTitle) children.push({ title: subTitle, url: subHref });
      }

      // Extract megamenu columns (divs with mega-column classes)
      const megaColumns = [];
      if (isMega) {
        for (const colMatch of liBody.matchAll(/<(?:div|ul)[^>]+class=["'][^"']*(?:mega-?col|kb-nav-mega)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|ul)>/gi)) {
          const colItems = [];
          for (const colA of colMatch[1].matchAll(/<a([^>]*)>([^<]*)<\/a>/gi)) {
            const colHref  = colA[1].match(/href=["']([^"']+)["']/i)?.[1] ?? "";
            const colTitle = colA[2].trim();
            if (colTitle) colItems.push({ title: colTitle, url: colHref });
          }
          if (colItems.length) megaColumns.push({ items: colItems });
        }
      }

      if (title) items.push({ title, url, classes: liClasses, megamenu: isMega, megamenuColumns: megaColumns, children });
    }

    if (items.length) {
      navs.push({ id: navId, classes: navClasses, ariaLabel, items });
    }
  }
  return navs;
}

async function migrateStyles(config, root, report, headers) {
  const stylesDir = path.join(root, config.stylesDir || DEFAULT_STYLES_DIR);
  const mediaRoot = path.join(root, config.mediaDir || "media");
  const dataRoot = path.join(root, config.dataDir || DEFAULT_DATA_DIR);
  const mediaPathPrefix = `/${config.mediaDir || "media"}`;
  let wpOrigin;
  try { wpOrigin = new URL(config.wpBaseUrl).origin; } catch { wpOrigin = config.wpBaseUrl; }

  const homepageHtml = await fetchText(ensureTrailingSlash(config.wpBaseUrl), headers);
  // Extract megamenu structure from rendered homepage HTML (fallback)
  const parsedNavs = extractNavFromHtml(homepageHtml, config.wpBaseUrl);
  const seedUrls = extractStylesheetUrls(homepageHtml, config.wpBaseUrl);
  const sameOriginSeed = seedUrls.filter((url) => {
    try { return new URL(url).origin === wpOrigin; } catch { return false; }
  });
  // External font CDN stylesheets: fetch as-is, do not follow their @imports
  const fontCdnPattern = /fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|use\.fontawesome\.com|kit\.fontawesome\.com/i;
  const externalFontUrls = seedUrls.filter((url) => {
    try { return new URL(url).origin !== wpOrigin && fontCdnPattern.test(url); } catch { return false; }
  });
  const filteredSeed = (config.preset === "kadence" || config.preset === "kadence-pro")
    ? sameOriginSeed.filter((url) => {
        const pattern = config.preset === "kadence-pro"
          ? /kadence|kadence-pro|pro|global-styles|blocks?|theme|style/i
          : /kadence|global-styles|blocks?|theme|style/i;
        return pattern.test(url);
      })
    : sameOriginSeed;

  // BFS: fetch all CSS and follow @import rules
  const cssCache = new Map();
  const queue = [...filteredSeed];
  const visited = new Set();

  while (queue.length > 0) {
    const cssUrl = queue.shift();
    if (visited.has(cssUrl)) continue;
    visited.add(cssUrl);
    try {
      const rawCss = await fetchText(cssUrl, headers);
      cssCache.set(cssUrl, rawCss);
      for (const importUrl of extractCssImports(rawCss, cssUrl)) {
        try {
          if (new URL(importUrl).origin === wpOrigin && !visited.has(importUrl)) queue.push(importUrl);
        } catch {}
      }
    } catch (err) {
      report.warnings.push(`Stylesheet fetch failed for ${cssUrl}: ${String(err.message || err)}`);
    }
  }

  // Fetch external font CDN stylesheets (no @import following)
  for (const fontUrl of externalFontUrls) {
    if (visited.has(fontUrl)) continue;
    visited.add(fontUrl);
    try {
      const rawCss = await fetchText(fontUrl);
      cssCache.set(fontUrl, rawCss);
    } catch (err) {
      report.warnings.push(`Font CDN stylesheet fetch failed for ${fontUrl}: ${String(err.message || err)}`);
    }
  }

  // Capture homepage inline <style> blocks as a synthetic entry
  const inlineStyleContent = extractInlineStyles(homepageHtml).join("\n\n");
  if (inlineStyleContent) cssCache.set("__inline__", inlineStyleContent);

  // Assign unique local filenames
  const usedNames = new Set();
  const urlToFilename = new Map();
  let idx = 0;
  for (const cssUrl of cssCache.keys()) {
    let fileName;
    if (cssUrl === "__inline__") {
      fileName = "inline-styles.css";
    } else {
      let urlObj;
      try { urlObj = new URL(cssUrl); } catch { urlObj = null; }
      const base = sanitizeFileSegment((urlObj ? path.basename(urlObj.pathname) : "") || `style-${idx + 1}.css`);
      fileName = base.endsWith(".css") ? base : `${base}.css`;
    }
    if (usedNames.has(fileName)) {
      const stem = fileName.slice(0, -4);
      let c = 1;
      while (usedNames.has(`${stem}-${c}.css`)) c++;
      fileName = `${stem}-${c}.css`;
    }
    usedNames.add(fileName);
    urlToFilename.set(cssUrl, fileName);
    idx++;
  }

  const stylesheets = [];
  const tokenMap = {};
  await fs.mkdir(stylesDir, { recursive: true });

  for (const [cssUrl, rawCss] of cssCache) {
    const fileName = urlToFilename.get(cssUrl);
    const isSameOrigin = cssUrl !== "__inline__" && (() => {
      try { return new URL(cssUrl).origin === wpOrigin; } catch { return false; }
    })();
    // Strip @import rules — imported files are saved as separate stylesheet entries
    let css = rawCss.replace(/@import\s+(?:url\(["']?[^"')]+["']?\)|["'][^"']*["'])[^;]*;/gi, "");
    // Rewrite url() references to local media paths (same-origin only)
    if (isSameOrigin) css = rewriteCssUrls(css, wpOrigin, mediaPathPrefix);

    // Download CSS-referenced media (background images, fonts) when downloadMedia is on (same-origin only)
    if (isSameOrigin && config.downloadMedia && !config.dryRun) {
      for (const mediaUrl of extractCssMediaUrls(rawCss, cssUrl)) {
        try {
          if (!mediaUrl.startsWith(wpOrigin)) continue;
          const mUrlObj = new URL(mediaUrl);
          const relPath = mUrlObj.pathname.replace(/^\/+/, "");
          const outMediaPath = path.join(mediaRoot, ...relPath.split("/").map(sanitizeFileSegment));
          if (!(await fileExists(outMediaPath))) await downloadFile(mediaUrl, outMediaPath, headers);
        } catch (err) {
          report.warnings.push(`CSS media download failed for ${mediaUrl}: ${String(err.message || err)}`);
        }
      }
    }

    Object.assign(tokenMap, extractCssVariables(css));
    const outPath = path.join(stylesDir, fileName);
    if (!config.dryRun) await fs.writeFile(outPath, css, "utf8");
    const sourceUrl = cssUrl === "__inline__" ? `${ensureTrailingSlash(config.wpBaseUrl)}(inline)` : cssUrl;
    stylesheets.push({ sourceUrl, outputPath: outPath, size: rawCss.length });
  }

  const manifestPath = path.join(stylesDir, "styles-manifest.json");
  const tokensPath = path.join(stylesDir, "design-tokens.json");
  if (!config.dryRun) {
    await fs.writeFile(manifestPath, `${JSON.stringify(stylesheets, null, 2)}\n`, "utf8");
    await fs.writeFile(tokensPath, `${JSON.stringify(tokenMap, null, 2)}\n`, "utf8");
  }

  // Generate _includes/legacy-styles.njk so layouts can {% include "legacy-styles.njk" %} in <head>
  const includesDir = path.join(root, "_includes");
  const legacyStylesIncludePath = path.join(includesDir, "legacy-styles.njk");
  const linkTags = stylesheets
    .map((s) => `<link rel="stylesheet" href="/${path.relative(root, s.outputPath).replace(/\\/g, "/")}">`)
    .join("\n");
  const includeContent = [
    `{# Generated by wp-eleventy-migrator — migrated WordPress stylesheets. #}`,
    `{# Add to your layout's <head>: {% include "legacy-styles.njk" %} #}`,
    linkTags,
    ""
  ].join("\n");
  if (!config.dryRun) {
    await fs.mkdir(includesDir, { recursive: true });
    await fs.writeFile(legacyStylesIncludePath, includeContent, "utf8");
  }

  report.styles = {
    migrated: stylesheets.length,
    stylesDir,
    manifestPath,
    tokensPath,
    legacyStylesInclude: legacyStylesIncludePath,
    stylesheetUrls: [...cssCache.keys()].filter((u) => u !== "__inline__")
  };

  if (parsedNavs.length) {
    report.styles.parsedNavs = parsedNavs.length;
    if (!config.dryRun) {
      const parsedNavPath = path.join(dataRoot, "navigation-parsed.json");
      // Wrap in same shape as navigation.json so templates work identically
      const parsedNavRecord = parsedNavs.map((nav, i) => ({
        id: nav.id || `parsed-nav-${i}`,
        slug: nav.id || `parsed-nav-${i}`,
        title: nav.ariaLabel || `Navigation ${i + 1}`,
        location: "",
        items: nav.items,
      }));
      await fs.writeFile(parsedNavPath, `${JSON.stringify(parsedNavRecord, null, 2)}\n`, "utf8");
      report.styles.parsedNavPath = parsedNavPath;
    }
  }
}

function buildTargetPermalink(type, slug, config) {
  if (type === "pages") return `/${slug}/`;
  const tpl = config.targetPermalinkPattern || "/{type}/{slug}/";
  return tpl.replaceAll("{type}", slugify(type)).replaceAll("{slug}", slugify(slug));
}

async function generateLayouts(config, root) {
  const includesDir = path.join(root, "_includes");
  const layoutDir = path.dirname(config.pageLayout || "layouts/page.njk");
  const baseLayoutName = `${layoutDir}/base.njk`;
  const baseLayoutPath = path.join(includesDir, baseLayoutName);
  const pageLayoutPath = path.join(includesDir, config.pageLayout || "layouts/page.njk");
  const postLayoutPath = path.join(includesDir, config.postLayout || "layouts/post.njk");
  const stylesLine = config.migrateStyles ? `  {% include "legacy-styles.njk" %}\n` : "";

  const base = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% if seoTitle %}{{ seoTitle }}{% elif title %}{{ title }}{% else %}Site{% endif %}</title>
  {% if seoDescription %}<meta name="description" content="{{ seoDescription }}">{% endif %}
  {% if ogTitle %}<meta property="og:title" content="{{ ogTitle }}">{% endif %}
  {% if ogDescription %}<meta property="og:description" content="{{ ogDescription }}">{% endif %}
  {% if ogImage %}<meta property="og:image" content="{{ ogImage }}">{% endif %}
  {% if canonical %}<link rel="canonical" href="{{ canonical }}">{% endif %}
  {% if noindex %}<meta name="robots" content="noindex">{% endif %}
${stylesLine}</head>
<body>
  {{ content | safe }}
</body>
</html>
`;

  const page = `---
layout: ${baseLayoutName}
---
<main class="page">
  <header class="page-header"><h1>{{ title }}</h1></header>
  <div class="page-content">{{ content | safe }}</div>
</main>
`;

  const post = `---
layout: ${baseLayoutName}
---
<main class="post">
  <header class="post-header">
    <h1>{{ title }}</h1>
    {% if date %}<time class="post-date" datetime="{{ date }}">{{ date }}</time>{% endif %}
    {% if author %}<span class="post-author">{{ author }}</span>{% endif %}
    {% if featuredImage %}<img class="post-featured-image" src="{{ featuredImage }}" alt="{{ title }}">{% endif %}
    {% if categories and categories.length %}<div class="post-categories">{% for c in categories %}<span>{{ c }}</span>{% endfor %}</div>{% endif %}
  </header>
  <div class="post-content">{{ content | safe }}</div>
  {% if tags and tags.length %}<footer class="post-footer"><div class="post-tags">{% for tag in tags %}<span>{{ tag }}</span>{% endfor %}</div></footer>{% endif %}
</main>
`;

  const writes = [
    [baseLayoutPath, base],
    [pageLayoutPath, page],
    [postLayoutPath, post]
  ];

  if (config.defaultLayout && config.defaultLayout !== config.pageLayout && config.defaultLayout !== config.postLayout) {
    const defaultLayoutPath = path.join(includesDir, config.defaultLayout);
    writes.push([defaultLayoutPath, `---\nlayout: ${baseLayoutName}\n---\n<main class="content">{{ content | safe }}</main>\n`]);
  }

  const generated = [];
  for (const [filePath, content] of writes) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (!(await fileExists(filePath))) {
      await fs.writeFile(filePath, content, "utf8");
      generated.push(filePath);
    }
  }
  return generated;
}

function safeJsonForNunjucks(value) {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function parseBlockAttrs(rawAttrs) {
  if (!rawAttrs) return {};
  try {
    return JSON.parse(rawAttrs);
  } catch {
    return {};
  }
}

function parseOpeningBlockComment(rawComment) {
  let value = String(rawComment || "").trim();
  let selfClosing = false;
  if (value.endsWith("/")) {
    selfClosing = true;
    value = value.slice(0, -1).trim();
  }

  const spaceIndex = value.indexOf(" ");
  if (spaceIndex === -1) return { blockName: value, attrs: {}, selfClosing };
  return {
    blockName: value.slice(0, spaceIndex).trim(),
    attrs: parseBlockAttrs(value.slice(spaceIndex + 1).trim()),
    selfClosing
  };
}

function parseWpBlocks(content) {
  const source = String(content || "");
  const root = { children: [] };
  const stack = [root];
  const pattern = /<!--\s*(\/?)wp:([\s\S]*?)-->/g;
  let lastIndex = 0;

  for (const match of source.matchAll(pattern)) {
    const [full, closingSlash, rawBody] = match;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      stack[stack.length - 1].children.push({ type: "html", value: source.slice(lastIndex, index) });
    }

    if (closingSlash) {
      const blockName = String(rawBody || "").trim();
      if (stack.length > 1 && stack[stack.length - 1].name === blockName) {
        stack.pop();
      }
      lastIndex = index + full.length;
      continue;
    }

    const { blockName, attrs, selfClosing } = parseOpeningBlockComment(rawBody);
    const node = {
      type: "block",
      name: blockName,
      attrs,
      children: []
    };
    stack[stack.length - 1].children.push(node);

    if (!selfClosing) stack.push(node);
    lastIndex = index + full.length;
  }

  if (lastIndex < source.length) {
    stack[stack.length - 1].children.push({ type: "html", value: source.slice(lastIndex) });
  }

  return root.children;
}

function kadenceSupportedBlocks(config) {
  return config.preset === "kadence-pro"
    ? [...SUPPORTED_KADENCE_BLOCKS, ...SUPPORTED_KADENCE_PRO_BLOCKS]
    : SUPPORTED_KADENCE_BLOCKS;
}

function extractSeoPluginMeta(item) {
  // Yoast SEO: structured JSON field (most complete)
  const yoastJson = item?.yoast_head_json;
  if (yoastJson && typeof yoastJson === "object") {
    const meta = {};
    if (yoastJson.title) meta.seoTitle = decodeHtml(yoastJson.title);
    if (yoastJson.description) meta.seoDescription = decodeHtml(yoastJson.description);
    if (yoastJson.og_title) meta.ogTitle = decodeHtml(yoastJson.og_title);
    if (yoastJson.og_description) meta.ogDescription = decodeHtml(yoastJson.og_description);
    if (yoastJson.og_image?.[0]?.url) meta.ogImage = yoastJson.og_image[0].url;
    if (yoastJson.canonical) meta.canonical = yoastJson.canonical;
    if (yoastJson.robots?.index === "noindex") meta.noindex = true;
    return meta;
  }

  // AIOSEO (aioseo_head) or Yoast fallback (yoast_head): parse rendered HTML
  const head = String(item?.aioseo_head || item?.yoast_head || "");
  if (!head) return {};

  const meta = {};
  const getAttr = (str, attr) => {
    const m = str.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, "i"));
    return m ? m[1] : "";
  };

  const titleM = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleM) meta.seoTitle = decodeHtml(titleM[1].trim());

  for (const metaM of head.matchAll(/<meta\s([^>]+?)(?:\s*\/)?>/gi)) {
    const attrs = metaM[1];
    const name = getAttr(attrs, "name") || getAttr(attrs, "property");
    const content = getAttr(attrs, "content");
    if (!name || !content) continue;
    switch (name.toLowerCase()) {
      case "description": meta.seoDescription = decodeHtml(content); break;
      case "robots": if (/noindex/.test(content)) meta.noindex = true; break;
      case "og:title": meta.ogTitle = decodeHtml(content); break;
      case "og:description": meta.ogDescription = decodeHtml(content); break;
      case "og:image": meta.ogImage = content; break;
      case "twitter:title": if (!meta.ogTitle) meta.ogTitle = decodeHtml(content); break;
      case "twitter:description": if (!meta.ogDescription) meta.ogDescription = decodeHtml(content); break;
      case "twitter:image": if (!meta.ogImage) meta.ogImage = content; break;
    }
  }

  const canonM = head.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || head.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (canonM) meta.canonical = canonM[1];

  return meta;
}

function renderBlockTree(nodes, config, warnings, state) {
  return nodes.map((node) => {
    if (node.type === "html") return node.value;

    const innerHtml = renderBlockTree(node.children || [], config, warnings, state);
    const [namespace, shortName] = String(node.name || "").split("/");
    if (config.convertKadenceBlocks && namespace === "kadence" && shortName && kadenceSupportedBlocks(config).includes(shortName)) {
      state.convertedCount += 1;
      state.seenBlocks.add(shortName);
      return [
        `{% set kadenceBlock = ${safeJsonForNunjucks({ name: node.name, shortName, attrs: node.attrs || {}, innerHtml })} %}`,
        `{% include "blocks/kadence/${shortName}.njk" %}`
      ].join("\n");
    }

    if (config.convertKadenceBlocks && namespace === "kadence" && shortName) {
      if (!state.unknownBlocks.has(shortName)) {
        warnings.push(`Unsupported Kadence block '${shortName}' left as inner HTML fallback.`);
        state.unknownBlocks.add(shortName);
      }
    }

    // Core block self-closing / semantic fallbacks
    if (namespace === "core") {
      switch (shortName) {
        case "separator": return "<hr>\n";
        case "spacer": {
          const h = node.attrs?.height;
          return `<div class="wp-block-spacer"${h ? ` style="height:${h}px"` : ""}></div>\n`;
        }
        case "more": return "<!-- more -->\n";
        case "nextpage": return "<!-- nextpage -->\n";
        default: break;
      }
    }

    return innerHtml;
  }).join("");
}

function convertKadenceBlocksToNunjucks(rawContent, config, warnings) {
  const source = String(rawContent || "");
  if (!source.includes("<!-- wp:kadence/")) {
    return { body: source, usedNunjucks: false, convertedCount: 0, seenBlocks: [], unknownBlocks: [] };
  }

  const tree = parseWpBlocks(source);
  const state = {
    convertedCount: 0,
    seenBlocks: new Set(),
    unknownBlocks: new Set()
  };
  const body = renderBlockTree(tree, config, warnings, state).trim();
  return {
    body,
    usedNunjucks: state.convertedCount > 0,
    convertedCount: state.convertedCount,
    seenBlocks: [...state.seenBlocks],
    unknownBlocks: [...state.unknownBlocks]
  };
}

const KADENCE_PARTIAL_TEMPLATES = {
  advancedheading: `{# kadence/advancedheading — Heading with configurable tag level, alignment and color #}
{% set b = kadenceBlock.attrs %}
{% set tag = "h" ~ (b.level if b.level else 2) %}
<{{ tag }}
  class="kadence-block kadence-advancedheading{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}id="kt-adv-heading_{{ b.uniqueID }}"{% endif %}
  {% if b.align or b.color %}style="{% if b.align %}text-align:{{ b.align }};{% endif %}{% if b.color %} color:{{ b.color }};{% endif %}"{% endif %}
>{{ kadenceBlock.innerHtml | safe }}</{{ tag }}>
`,

  advancedbtn: `{# kadence/advancedbtn — Button group; innerHtml contains individual button elements #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-advancedbtn{% if b.hAlign %} kadence-btn-align-{{ b.hAlign }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {{ kadenceBlock.innerHtml | safe }}
</div>
`,

  rowlayout: `{# kadence/rowlayout — Multi-column section; columns are nested kadence/column blocks #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-rowlayout{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
  {% if b.background or (b.backgroundImg and b.backgroundImg[0] and b.backgroundImg[0].bgImg) %}style="{% if b.background %}background-color:{{ b.background }};{% endif %}{% if b.backgroundImg and b.backgroundImg[0] and b.backgroundImg[0].bgImg %} background-image:url('{{ b.backgroundImg[0].bgImg }}');{% endif %}"{% endif %}
>
  {{ kadenceBlock.innerHtml | safe }}
</section>
`,

  column: `{# kadence/column — Single column within a rowlayout #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-column{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {{ kadenceBlock.innerHtml | safe }}
</div>
`,

  image: `{# kadence/image — Image with optional link, alt text and caption #}
{% set b = kadenceBlock.attrs %}
<figure
  class="kadence-block kadence-image{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {% if b.link %}<a href="{{ b.link }}"{% if b.linkTarget %} target="{{ b.linkTarget }}"{% endif %}>{% endif %}
  {% if b.url %}
    <img
      src="{{ b.url }}"
      alt="{{ b.alt if b.alt else "" }}"
      {% if b.width %}width="{{ b.width }}"{% endif %}
      {% if b.height %}height="{{ b.height }}"{% endif %}
    >
  {% else %}
    {{ kadenceBlock.innerHtml | safe }}
  {% endif %}
  {% if b.link %}</a>{% endif %}
  {% if b.caption %}<figcaption>{{ b.caption }}</figcaption>{% endif %}
</figure>
`,

  gallery: `{# kadence/gallery — Image grid gallery; images array in attrs #}
{% set b = kadenceBlock.attrs %}
<figure
  class="kadence-block kadence-gallery{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {% if b.images and b.images | length %}
    <ul class="kadence-gallery-grid kadence-gallery-columns-{{ b.columns if b.columns else 3 }}">
      {% for img in b.images %}
        <li class="kadence-gallery-item">
          <figure>
            <img src="{{ img.url }}" alt="{{ img.alt if img.alt else "" }}"{% if img.width %} width="{{ img.width }}"{% endif %}{% if img.height %} height="{{ img.height }}"{% endif %}>
            {% if img.caption %}<figcaption>{{ img.caption }}</figcaption>{% endif %}
          </figure>
        </li>
      {% endfor %}
    </ul>
  {% else %}
    {{ kadenceBlock.innerHtml | safe }}
  {% endif %}
</figure>
`,

  tabs: `{# kadence/tabs — Tab group container; tab titles and panels in innerHtml; add JS for interactivity #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-tabs{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
  role="tablist"
>
  {{ kadenceBlock.innerHtml | safe }}
</div>
`,

  tab: `{# kadence/tab — Single tab panel #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-tab{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}id="kt-tab_{{ b.uniqueID }}"{% endif %}
  role="tabpanel"
>
  {% if b.title %}<div class="kadence-tab-title">{{ b.title }}</div>{% endif %}
  {{ kadenceBlock.innerHtml | safe }}
</div>
`,

  accordion: `{# kadence/accordion — Accordion wrapper; panes use native <details>/<summary> #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-accordion{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {{ kadenceBlock.innerHtml | safe }}
</div>
`,

  pane: `{# kadence/pane — Accordion pane; uses <details>/<summary> for native expand/collapse #}
{% set b = kadenceBlock.attrs %}
<details
  class="kadence-block kadence-pane{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}id="kt-accordion-pane_{{ b.uniqueID }}"{% endif %}
  {% if b.startOpen %}open{% endif %}
>
  {% if b.title %}
    <summary class="kadence-pane-title">{{ b.title }}</summary>
  {% endif %}
  <div class="kadence-pane-content">
    {{ kadenceBlock.innerHtml | safe }}
  </div>
</details>
`,

  infobox: `{# kadence/infobox — Info card with optional icon, title and body text #}
{% set b = kadenceBlock.attrs %}
<article
  class="kadence-block kadence-infobox{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {% if b.title %}
    <h3 class="kadence-infobox-title">{{ b.title }}</h3>
  {% endif %}
  <div class="kadence-infobox-content">
    {{ kadenceBlock.innerHtml | safe }}
  </div>
</article>
`,

  icon: `{# kadence/icon — Single icon; innerHtml contains the rendered SVG or icon font markup #}
{% set b = kadenceBlock.attrs %}
<span
  class="kadence-block kadence-icon{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
  aria-hidden="true"
>
  {{ kadenceBlock.innerHtml | safe }}
</span>
`,

  iconlist: `{# kadence/iconlist — List with icon bullets; items are kadence/listitem blocks #}
{% set b = kadenceBlock.attrs %}
<ul
  class="kadence-block kadence-iconlist{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {{ kadenceBlock.innerHtml | safe }}
</ul>
`,

  listitem: `{# kadence/listitem — Single icon list item #}
{% set b = kadenceBlock.attrs %}
<li class="kadence-block kadence-listitem{% if b.className %} {{ b.className }}{% endif %}">
  {% if b.icon %}
    <span class="kadence-listitem-icon" aria-hidden="true">{{ b.icon }}</span>
  {% endif %}
  <span class="kadence-listitem-text">{{ kadenceBlock.innerHtml | safe }}</span>
</li>
`,

  spacer: `{# kadence/spacer — Vertical spacer with optional horizontal rule #}
{% set b = kadenceBlock.attrs %}
{% set h = b.spacerHeight[0] if (b.spacerHeight and b.spacerHeight[0]) else 60 %}
<div
  class="kadence-block kadence-spacer{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
  style="height:{{ h }}px;"
  aria-hidden="true"
>
  {% if b.dividerEnable %}
    <hr
      class="kadence-spacer-divider"
      style="{% if b.dividerStyle %}border-style:{{ b.dividerStyle }};{% endif %}{% if b.dividerColor %} border-color:{{ b.dividerColor }};{% endif %}{% if b.dividerWidth %} width:{{ b.dividerWidth }}%;{% endif %}"
    >
  {% endif %}
</div>
`,

  testimonials: `{# kadence/testimonials — Testimonials grid; items are kadence/testimonial blocks #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-testimonials{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {{ kadenceBlock.innerHtml | safe }}
</section>
`,

  testimonial: `{# kadence/testimonial — Single testimonial with star rating, quote and attribution #}
{% set b = kadenceBlock.attrs %}
{% set stars = b.rating | int if b.rating else 0 %}
<figure
  class="kadence-block kadence-testimonial{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {% if stars %}
    <div class="kadence-testimonial-rating" aria-label="Rating: {{ stars }} out of 5">
      {% for i in range(stars) %}<span aria-hidden="true">★</span>{% endfor %}
      {% for i in range(5 - stars) %}<span aria-hidden="true">☆</span>{% endfor %}
    </div>
  {% endif %}
  <blockquote class="kadence-testimonial-content">
    {{ kadenceBlock.innerHtml | safe }}
  </blockquote>
  <figcaption class="kadence-testimonial-author">
    {% if b.url %}
      <img class="kadence-testimonial-avatar" src="{{ b.url }}" alt="{{ b.name if b.name else "" }}" width="60" height="60">
    {% endif %}
    {% if b.name %}<strong class="kadence-testimonial-name">{{ b.name }}</strong>{% endif %}
    {% if b.occupation %}<span class="kadence-testimonial-occupation">{{ b.occupation }}</span>{% endif %}
  </figcaption>
</figure>
`,

  form: `{# kadence/form — Contact form. Replace <form> action with your static host's handler (Netlify, Formspree…). #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-form{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {% if b.formTitle %}<h2 class="kadence-form-title">{{ b.formTitle }}</h2>{% endif %}
  {# TODO: set action/method/data-netlify for your static site form handler #}
  <form method="post" data-netlify="true">
    {{ kadenceBlock.innerHtml | safe }}
    <button type="submit">{{ b.submitLabel if b.submitLabel else "Submit" }}</button>
  </form>
</section>
`,

  // ── Kadence PRO blocks ────────────────────────────────────────────────────

  countdown: `{# kadence/countdown (PRO) — Countdown timer; requires JS to tick. Read data-countdown-date. #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-countdown{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
  {% if b.date %}data-countdown-date="{{ b.date }}"{% endif %}
  {% if b.timezone %}data-countdown-timezone="{{ b.timezone }}"{% endif %}
>
  <div class="kadence-countdown-display" aria-live="polite">
    <span class="kadence-countdown-days">--</span><span class="kadence-countdown-label">d</span>
    <span class="kadence-countdown-hours">--</span><span class="kadence-countdown-label">h</span>
    <span class="kadence-countdown-minutes">--</span><span class="kadence-countdown-label">m</span>
    <span class="kadence-countdown-seconds">--</span><span class="kadence-countdown-label">s</span>
  </div>
  {{ kadenceBlock.innerHtml | safe }}
</div>
`,

  videopopup: `{# kadence/videopopup (PRO) — Video popup trigger; add JS lightbox to handle .kadence-videopopup-trigger clicks #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-videopopup{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {% if b.url %}
    <a
      class="kadence-videopopup-trigger"
      href="{{ b.url }}"
      {% if b.type %}data-video-type="{{ b.type }}"{% endif %}
      aria-label="Play video"
    >
      {{ kadenceBlock.innerHtml | safe }}
    </a>
  {% else %}
    {{ kadenceBlock.innerHtml | safe }}
  {% endif %}
</div>
`,

  lottie: `{# kadence/lottie (PRO) — Lottie animation; requires @lottiefiles/lottie-player script #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-lottie{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {% if b.fileUrl %}
    <lottie-player
      src="{{ b.fileUrl }}"
      {% if b.loop %}loop{% endif %}
      {% if b.autoplay %}autoplay{% endif %}
      style="width:100%"
    ></lottie-player>
  {% else %}
    {{ kadenceBlock.innerHtml | safe }}
  {% endif %}
</div>
`,

  modal: `{# kadence/modal (PRO) — Modal dialog using native <dialog>; wire JS for browsers lacking showModal() #}
{% set b = kadenceBlock.attrs %}
{% set modalId = "kadence-modal-" ~ (b.uniqueID if b.uniqueID else "1") %}
<div
  class="kadence-block kadence-modal{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  <button
    class="kadence-modal-trigger"
    type="button"
    aria-haspopup="dialog"
    aria-controls="{{ modalId }}"
  >{{ b.trigger if b.trigger else "Open" }}</button>
  <dialog id="{{ modalId }}" class="kadence-modal-dialog">
    {% if b.title %}<h2 class="kadence-modal-title">{{ b.title }}</h2>{% endif %}
    <form method="dialog">
      <button class="kadence-modal-close" aria-label="Close">×</button>
    </form>
    <div class="kadence-modal-content">
      {{ kadenceBlock.innerHtml | safe }}
    </div>
  </dialog>
</div>
`,

  navigation: `{# kadence/navigation (PRO) — Megamenu-aware site navigation
     Data sources (in priority order):
       1. kadenceBlock.attrs.menuSlug   → finds menu in navigation data by slug
       2. navigation (global _data/navigation.json first menu)
       3. navigation-parsed (global _data/navigation-parsed.json first nav)
     Megamenu columns are rendered when item.megamenu == true.
  #}
{% set b = kadenceBlock.attrs %}
{% set menuSlug = b.menuSlug if b.menuSlug else "" %}

{# Resolve menu items — navigation.json uses field "items" #}
{% if menuSlug and navigation %}
  {% for m in navigation %}
    {% if m.slug == menuSlug %}{% set menuItems = m.items %}{% endif %}
  {% endfor %}
{% endif %}
{% if not menuItems and navigation and navigation.length %}
  {% set menuItems = navigation[0].items %}
{% endif %}

<nav
  class="wp-block-kadence-navigation kb-navigation kadence-block kadence-navigation{% if b.uniqueID %} kb-navigation-id_{{ b.uniqueID }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
  aria-label="{{ b.ariaLabel if b.ariaLabel else "Site navigation" }}"
>
  <button class="kb-nav-toggle" aria-expanded="false" aria-controls="kb-nav-menu-{{ b.uniqueID if b.uniqueID else "main" }}">
    <span class="screen-reader-text">Menu</span>
    <span class="kb-nav-toggle-icon" aria-hidden="true">&#9776;</span>
  </button>

  <ul id="kb-nav-menu-{{ b.uniqueID if b.uniqueID else "main" }}" class="menu kb-nav-menu">
    {% if menuItems %}
      {% for item in menuItems %}
        <li class="menu-item kb-nav-item{% for cls in item.classes %} {{ cls }}{% endfor %}{% if item.children and item.children.length %} menu-item-has-children{% endif %}{% if item.megamenu %} kb-nav-mega-menu-item{% endif %}">

          <a href="{{ item.url }}"
            {% if item.target %} target="{{ item.target }}"{% endif %}
            {% if item.rel %} rel="{{ item.rel }}"{% endif %}
            class="kb-nav-link{% if item.current %} current-menu-item{% endif %}"
          >{{ item.title }}</a>

          {# ── Megamenu ────────────────────────────────────────── #}
          {% if item.megamenu and item.megamenuColumns and item.megamenuColumns.length %}
            <div class="kb-mega-menu"
              {% if item.megamenuWidth %} style="max-width:{{ item.megamenuWidth }}"{% endif %}
              role="region"
              aria-label="{{ item.title }} megamenu"
            >
              <ul class="kb-mega-menu-cols">
                {% for col in item.megamenuColumns %}
                  <li class="kb-mega-menu-col">
                    {% if col.heading %}<p class="kb-mega-col-heading">{{ col.heading }}</p>{% endif %}
                    {% if col.items and col.items.length %}
                      <ul class="kb-mega-col-items">
                        {% for sub in col.items %}
                          <li class="menu-item">
                            <a href="{{ sub.url }}" class="kb-mega-link">
                              {% if sub.icon %}<span class="kb-mega-icon" aria-hidden="true">{{ sub.icon | safe }}</span>{% endif %}
                              {{ sub.title }}
                              {% if sub.description %}<span class="kb-mega-desc">{{ sub.description }}</span>{% endif %}
                            </a>
                          </li>
                        {% endfor %}
                      </ul>
                    {% endif %}
                  </li>
                {% endfor %}
              </ul>
            </div>

          {# ── Normal dropdown ─────────────────────────────────── #}
          {% elif item.children and item.children.length %}
            <ul class="sub-menu kb-nav-sub-menu">
              {% for child in item.children %}
                <li class="menu-item kb-nav-item{% if child.children and child.children.length %} menu-item-has-children{% endif %}">
                  <a href="{{ child.url }}"
                    {% if child.target %} target="{{ child.target }}"{% endif %}
                    {% if child.rel %} rel="{{ child.rel }}"{% endif %}
                    class="kb-nav-link"
                  >{{ child.title }}</a>
                  {% if child.children and child.children.length %}
                    <ul class="sub-menu kb-nav-sub-menu kb-nav-sub-menu--level2">
                      {% for grandchild in child.children %}
                        <li class="menu-item kb-nav-item">
                          <a href="{{ grandchild.url }}"
                            {% if grandchild.target %} target="{{ grandchild.target }}"{% endif %}
                            class="kb-nav-link"
                          >{{ grandchild.title }}</a>
                        </li>
                      {% endfor %}
                    </ul>
                  {% endif %}
                </li>
              {% endfor %}
            </ul>
          {% endif %}

        </li>
      {% endfor %}
    {% else %}
      {# Fallback: raw inner HTML from block (WP rendered output) #}
      {{ kadenceBlock.rawHtml | safe }}
    {% endif %}
  </ul>
</nav>
`,

  "off-canvas": `{# kadence/off-canvas (PRO) — Off-canvas drawer; JS must toggle aria-expanded and hidden on the drawer #}
{% set b = kadenceBlock.attrs %}
{% set drawerId = "kadence-offcanvas-" ~ (b.uniqueID if b.uniqueID else "1") %}
<div
  class="kadence-block kadence-off-canvas{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  <button
    class="kadence-off-canvas-trigger"
    type="button"
    aria-expanded="false"
    aria-controls="{{ drawerId }}"
    aria-label="Open menu"
  >☰</button>
  <div id="{{ drawerId }}" class="kadence-off-canvas-drawer" hidden>
    <button class="kadence-off-canvas-close" type="button" aria-label="Close menu">×</button>
    {{ kadenceBlock.innerHtml | safe }}
  </div>
</div>
`,

  "show-more": `{# kadence/show-more (PRO) — Expandable content using native <details>/<summary>; no JS needed #}
{% set b = kadenceBlock.attrs %}
<details
  class="kadence-block kadence-show-more{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  <summary class="kadence-show-more-toggle">
    {{ b.showHideMore if b.showHideMore else "Show more" }}
  </summary>
  {{ kadenceBlock.innerHtml | safe }}
</details>
`,

  dynamichtml: `{# kadence/dynamichtml (PRO) — Dynamic query block; replace with an Eleventy collection loop #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-dynamichtml{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {# TODO: replace with Eleventy collection loop — e.g. {% for post in collections.posts %} #}
  {{ kadenceBlock.innerHtml | safe }}
</div>
`,

  identity: `{# kadence/identity (PRO) — Site logo, name and tagline from _data/site.json #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-identity{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {% if b.showLogo !== false %}
    <a class="kadence-identity-logo" href="/">
      {% if site.logo %}
        <img src="{{ site.logo }}" alt="{{ site.name if site.name else "Home" }}" height="40">
      {% else %}
        {# Add logo path to _data/site.json: { "logo": "/img/logo.svg", "name": "Site Name" } #}
      {% endif %}
    </a>
  {% endif %}
  {% if b.showTitle !== false %}
    <span class="kadence-identity-title">{{ site.name if site.name else "Site Name" }}</span>
  {% endif %}
  {% if b.showTagline !== false and site.tagline %}
    <span class="kadence-identity-tagline">{{ site.tagline }}</span>
  {% endif %}
</div>
`,

  contentwidget: `{# kadence/contentwidget (PRO) — Widget area; replace with your Eleventy sidebar include #}
{% set b = kadenceBlock.attrs %}
<aside
  class="kadence-block kadence-contentwidget{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {# TODO: replace with your sidebar partial — {% include "partials/sidebar.njk" %} #}
  {{ kadenceBlock.innerHtml | safe }}
</aside>
`,

  splitcontent: `{# kadence/splitcontent (PRO) — Two-column split layout (e.g. media + text) #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-splitcontent{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {{ kadenceBlock.innerHtml | safe }}
</section>
`,

  "table-of-contents": `{# kadence/table-of-contents (PRO) — Auto-generated TOC; replace with eleventy-plugin-toc or a macro #}
{% set b = kadenceBlock.attrs %}
<nav
  class="kadence-block kadence-toc{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
  aria-label="Table of contents"
>
  {# TODO: generate with eleventy-plugin-toc or a custom Nunjucks macro #}
  {{ kadenceBlock.innerHtml | safe }}
</nav>
`,

  postcarousel: `{# kadence/postcarousel (PRO) — Post loop/carousel; replace with an Eleventy collection loop #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-postcarousel{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {# TODO: replace with Eleventy loop:
     {% for post in collections.posts | reverse | limit(b.postsToShow | default(3)) %}
       <article><a href="{{ post.url }}">{{ post.data.title }}</a></article>
     {% endfor %} #}
  {{ kadenceBlock.innerHtml | safe }}
</section>
`,

  portfoliogrid: `{# kadence/portfoliogrid (PRO) — Portfolio grid; replace with an Eleventy collection loop #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-portfoliogrid{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {# TODO: replace with Eleventy portfolio collection loop #}
  {{ kadenceBlock.innerHtml | safe }}
</section>
`
};

function kadencePartialTemplate(name) {
  const raw = Object.prototype.hasOwnProperty.call(KADENCE_PARTIAL_TEMPLATES, name)
    ? KADENCE_PARTIAL_TEMPLATES[name]
    : `{# kadence/${name} — Generic fallback. Customize this partial. #}\n{% set b = kadenceBlock.attrs %}\n<div\n  class="kadence-block kadence-${name}{% if b.className %} {{ b.className }}{% endif %}"\n  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}\n>\n  {{ kadenceBlock.innerHtml | safe }}\n</div>\n`;

  // Inject standard WordPress block class, Kadence kb-* class and uniqueID-scoped class.
  // All three together ensure that CSS downloaded from the WordPress site still applies.
  const css = KADENCE_BLOCK_CSS[name] || {};
  const wpClass = `wp-block-kadence-${name}`;
  const kbClass = css.wrap ? ` ${css.wrap}` : "";
  const uidFrag = css.uid ? `{% if b.uniqueID %} ${css.uid}_{{ b.uniqueID }}{% endif %}` : "";

  // The templates open with: class="kadence-block kadence-{name} (or kadence-toc for table-of-contents)
  // Find whichever variant is present and prepend the Kadence CSS classes.
  const needle = raw.includes(`class="kadence-block kadence-${name}`)
    ? `class="kadence-block kadence-${name}`
    : `class="kadence-block kadence-toc`; // table-of-contents uses kadence-toc shorthand
  const replacement = `class="${wpClass}${kbClass} kadence-block kadence-${name}${uidFrag}`;
  return raw.replace(needle, replacement);
}

async function writeKadencePartials(outputRoot, blocksDir, preset) {
  const absoluteDir = path.join(outputRoot, blocksDir);
  await fs.mkdir(absoluteDir, { recursive: true });
  const blocks = preset === "kadence-pro"
    ? [...SUPPORTED_KADENCE_BLOCKS, ...SUPPORTED_KADENCE_PRO_BLOCKS]
    : SUPPORTED_KADENCE_BLOCKS;
  await Promise.all(blocks.map((name) => {
    const filePath = path.join(absoluteDir, `${name}.njk`);
    return fs.writeFile(filePath, kadencePartialTemplate(name), "utf8");
  }));
  return absoluteDir;
}

function resolveLayoutForType(type, config) {
  if (!config.useNunjucksLayouts) return "";
  if (type === "pages") return String(config.pageLayout || "").trim();
  if (type === "posts") return String(config.postLayout || "").trim();
  return String(config.defaultLayout || "").trim();
}

function itemToDoc(item, type, config, categoryMap, tagMap, warnings) {
  const title = decodeHtml(item?.title?.rendered || item?.title || `Untitled ${item?.id || ""}`.trim());
  const slug = slugify(item?.slug || title);
  const excerpt = stripHtml(item?.excerpt?.rendered || item?.excerpt || "");
  const categories = Array.isArray(item?.categories) ? item.categories.map((id) => categoryMap.get(id)).filter(Boolean) : [];
  const tags = Array.isArray(item?.tags) ? item.tags.map((id) => tagMap.get(id)).filter(Boolean) : [];
  const rawBlockContent = item?.content?.raw || "";
  const renderedHtml = item?.content?.rendered || item?.content || "";
  const permalink = buildTargetPermalink(type, slug, config);
  const layout = resolveLayoutForType(type, config);
  let body = config.htmlMode === "basic-markdown" ? basicHtmlToMarkdown(renderedHtml) : String(renderedHtml).trim();
  let fileExtension = "md";
  let kadenceBlocks = [];
  let convertedKadenceBlocks = false;

  if (config.convertKadenceBlocks) {
    if (rawBlockContent) {
      const converted = convertKadenceBlocksToNunjucks(rawBlockContent, config, warnings);
      if (converted.usedNunjucks) {
        body = converted.body;
        fileExtension = "njk";
        kadenceBlocks = converted.seenBlocks;
        convertedKadenceBlocks = true;
      }
    } else {
      warnings.push(`Kadence conversion requested for '${type}/${slug}', but raw block content was unavailable. Use authenticated REST access with context=edit if possible.`);
    }
  }

  const shortcodes = detectShortcodes(body);
  if (shortcodes.length) {
    warnings.push(`Possible unrendered shortcodes in '${type}/${slug}': ${shortcodes.map((s) => `[${s}]`).join(", ")}`);
  }

  const embedded = item?._embedded || {};
  const featuredImageUrl = embedded["wp:featuredmedia"]?.[0]?.source_url || "";
  const authorName = decodeHtml(embedded["author"]?.[0]?.name || "");
  const customTaxonomies = {};
  for (const termGroup of (embedded["wp:term"] || [])) {
    if (!Array.isArray(termGroup) || !termGroup.length) continue;
    const taxonomy = termGroup[0].taxonomy;
    if (taxonomy === "category" || taxonomy === "post_tag") continue;
    const names = termGroup.map((t) => t.name).filter(Boolean);
    if (names.length) customTaxonomies[slugify(taxonomy)] = names;
  }

  const frontMatter = {
    title,
    date: item?.date || "",
    updated: item?.modified || "",
    slug,
    status: item?.status || "publish",
    sourceType: type,
    sourceId: item?.id || "",
    sourceUrl: item?.link || "",
    excerpt,
    categories,
    tags
  };
  if (authorName) frontMatter.author = authorName;
  if (featuredImageUrl) frontMatter.featuredImage = featuredImageUrl;
  if (item?.sticky === true) frontMatter.sticky = true;
  if (item?.format && item.format !== "standard") frontMatter.format = item.format;
  for (const [key, val] of Object.entries(customTaxonomies)) frontMatter[key] = val;
  if (layout) frontMatter.layout = layout;
  if (convertedKadenceBlocks) frontMatter.kadenceBlocks = kadenceBlocks;

  const seoMeta = extractSeoPluginMeta(item);
  if (seoMeta.seoTitle) frontMatter.seoTitle = seoMeta.seoTitle;
  if (seoMeta.seoDescription) frontMatter.seoDescription = seoMeta.seoDescription;
  if (seoMeta.ogTitle) frontMatter.ogTitle = seoMeta.ogTitle;
  if (seoMeta.ogDescription) frontMatter.ogDescription = seoMeta.ogDescription;
  if (seoMeta.ogImage) frontMatter.ogImage = seoMeta.ogImage;
  if (seoMeta.canonical) frontMatter.canonical = seoMeta.canonical;
  if (seoMeta.noindex) frontMatter.noindex = true;

  return {
    title,
    slug,
    permalink,
    frontMatter,
    body,
    fileExtension,
    convertedKadenceBlocks
  };
}

async function runMigration(configPath, explicitConfig, progress = () => {}) {
  const config = explicitConfig || JSON.parse(await fs.readFile(configPath, "utf8"));
  const report = {
    startedAt: new Date().toISOString(),
    configPath,
    sourceType: config.sourceType,
    totals: {},
    redirects: [],
    warnings: []
  };

  if (config.sourceType !== "rest") {
    report.warnings.push(`Source type '${config.sourceType}' is not implemented yet. Use 'rest'.`);
    return report;
  }

  progress("info", `Migraatio käynnistetty → ${config.wpBaseUrl}`);
  progress("info", `Tulostehakemisto: ${config.outputRoot}${config.dryRun ? " (dry run)" : ""}`);

  const root = path.resolve(process.cwd(), config.outputRoot);
  const contentRoot = path.join(root, config.contentDir);
  const mediaRoot = path.join(root, config.mediaDir);
  const dataRoot = path.join(root, config.dataDir || DEFAULT_DATA_DIR);
  const kadencePartialsPath = path.join(root, config.kadenceBlocksDir || DEFAULT_KADENCE_BLOCKS_DIR);
  await fs.mkdir(contentRoot, { recursive: true });
  if (config.downloadMedia) await fs.mkdir(mediaRoot, { recursive: true });
  if (config.importMenus) await fs.mkdir(dataRoot, { recursive: true });

  if (config.convertKadenceBlocks) {
    const allKadenceBlocks = config.preset === "kadence-pro"
      ? [...SUPPORTED_KADENCE_BLOCKS, ...SUPPORTED_KADENCE_PRO_BLOCKS]
      : SUPPORTED_KADENCE_BLOCKS;
    report.kadenceBlocks = {
      partialsPath: kadencePartialsPath,
      supportedBlocks: allKadenceBlocks,
      proBlocks: config.preset === "kadence-pro"
    };
    if (!config.dryRun) {
      await writeKadencePartials(root, config.kadenceBlocksDir || DEFAULT_KADENCE_BLOCKS_DIR, config.preset);
      progress("ok", `Kirjoitettu ${allKadenceBlocks.length} Kadence-blokkipartiaalia`);
    }
  }

  if (config.convertKadenceBlocks && config.htmlMode === "basic-markdown") {
    report.warnings.push("Kadence block conversion uses raw block content and writes Nunjucks templates. HTML mode 'basic-markdown' is ignored for converted Kadence documents.");
  }

  if (config.useNunjucksLayouts) {
    if (!config.dryRun) {
      try {
        progress("info", "Generoidaan Nunjucks-layoutit…");
        const generatedLayouts = await generateLayouts(config, root);
        report.layouts = { generated: generatedLayouts };
        progress("ok", `Layoutit: ${generatedLayouts.map((p) => path.basename(p)).join(", ")}`);
      } catch (err) {
        report.warnings.push(`Layout generation failed: ${String(err.message || err)}`);
        progress("warn", `Layouttien generointi epäonnistui: ${err.message}`);
      }
    } else {
      report.layouts = { generated: [], note: "Layout files will be generated on non-dry-run" };
    }
  }

  const headers = {};
  if (config.authMode === "app-password" && config.wpUser && config.wpAppPassword) {
    const token = Buffer.from(`${config.wpUser}:${config.wpAppPassword}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
    progress("ok", "Autentikointi: app-password");
  } else if (config.authMode === "bearer" && config.wpBearerToken) {
    headers.Authorization = `Bearer ${config.wpBearerToken}`;
    progress("ok", "Autentikointi: bearer token");
  }

  const baseApi = joinUrl(config.wpBaseUrl, config.restNamespace || DEFAULT_NAMESPACE);

  progress("info", "Haetaan taksonomiat (kategoriat, tagit)…");
  printStep("fetch", `Taxonomies from ${baseApi}`);
  const [cats, tags] = await Promise.all([
    fetchAllPages(`${baseApi}/categories`, headers).catch(() => []),
    fetchAllPages(`${baseApi}/tags`, headers).catch(() => [])
  ]);
  const categoryMap = new Map(cats.map((c) => [c.id, c.name]));
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));
  progress("ok", `Taksonomiat: ${cats.length} kategoriaa, ${tags.length} tagia`);

  if (config.migrateStyles) {
    progress("info", "Haetaan tyylitiedostot ja design tokens…");
    printStep("fetch", "Stylesheets and design tokens");
    try {
      await migrateStyles(config, root, report, headers);
      progress("ok", `Tyylit siirretty${report.styles?.downloaded ? ` (${report.styles.downloaded} tiedostoa)` : ""}`);
    } catch (err) {
      report.warnings.push(`Style migration failed: ${String(err.message || err)}`);
      progress("warn", `Tyylien siirto epäonnistui: ${err.message}`);
    }
  }

  if (config.importMenus) {
    progress("info", "Haetaan valikot…");
    printStep("fetch", "Menus (best effort)");
    const menuResult = await fetchMenus(config.wpBaseUrl, headers, report.warnings);
    report.menus = {
      imported: menuResult.menus.length,
      source: menuResult.source || "none"
    };
    if (menuResult.menus.length) {
      const navigationPath = path.join(dataRoot, "navigation.json");
      report.menus.outputPath = navigationPath;
      if (!config.dryRun) await fs.writeFile(navigationPath, `${JSON.stringify(menuResult.menus, null, 2)}\n`, "utf8");
      progress("ok", `Valikot: ${menuResult.menus.length} kpl (lähde: ${menuResult.source})`);
    } else {
      // Fallback: parse nav structure from rendered homepage HTML
      progress("warn", "REST API ei palauttanut valikoita — yritetään parsia renderöidystä HTML:stä…");
      try {
        const homepageHtml = await fetchText(ensureTrailingSlash(config.wpBaseUrl), headers);
        const parsedNavs = extractNavFromHtml(homepageHtml, config.wpBaseUrl);
        if (parsedNavs.length) {
          const parsedNavRecord = parsedNavs.map((nav, i) => ({
            id: nav.id || `parsed-nav-${i}`,
            slug: nav.id || `parsed-nav-${i}`,
            title: nav.ariaLabel || `Navigation ${i + 1}`,
            location: "",
            items: nav.items,
          }));
          const navigationPath = path.join(dataRoot, "navigation.json");
          report.menus.outputPath = navigationPath;
          report.menus.source = "html-fallback";
          report.menus.imported = parsedNavRecord.length;
          if (!config.dryRun) await fs.writeFile(navigationPath, `${JSON.stringify(parsedNavRecord, null, 2)}\n`, "utf8");
          progress("ok", `Valikot parsittu HTML:stä: ${parsedNavRecord.length} kpl`);
        } else {
          report.warnings.push("No menu structure was imported. WordPress menus often need a dedicated menu REST endpoint or plugin.");
          progress("warn", "Valikkoja ei löydetty REST API:sta eikä HTML:stä");
        }
      } catch (err) {
        report.warnings.push(`Menu HTML fallback failed: ${String(err.message || err)}`);
        progress("warn", `Valikkojen parsinta epäonnistui: ${err.message}`);
      }
    }
  }

  for (const type of config.contentTypes) {
    const typeSlug = slugify(type);
    const endpointBase = `${baseApi}/${type}`;
    const baseWithEmbed = `${endpointBase}?_embed=1`;
    const endpoint = config.authMode !== "none"
      ? `${endpointBase}?context=edit&_embed=1`
      : baseWithEmbed;
    progress("info", `Haetaan ${type}…`);
    printStep("fetch", `${type} -> ${endpoint}`);
    let items;
    try {
      items = await fetchAllPages(endpoint, headers);
    } catch (err) {
      if (endpoint !== baseWithEmbed) {
        report.warnings.push(`Falling back to rendered content for ${type}: ${String(err.message || err)}`);
        progress("warn", `Fallback renderöityyn sisältöön (${type})`);
        items = await fetchAllPages(baseWithEmbed, headers);
      } else {
        throw err;
      }
    }
    if (!config.includeDrafts) items = items.filter((i) => i?.status === "publish");
    progress("ok", `${type}: ${items.length} julkaistua kohdetta haettu`);

    const outTypeDir = path.join(contentRoot, typeSlug);
    await fs.mkdir(outTypeDir, { recursive: true });

    let written = 0;
    for (const item of items) {
      const doc = itemToDoc(item, typeSlug, config, categoryMap, tagMap, report.warnings);
      const datePart = typeSlug === "posts" ? `${toIsoDay(item?.date)}-` : "";
      const fileName = `${datePart}${doc.slug}.${doc.fileExtension}`;
      const filePath = path.join(outTypeDir, fileName);
      const frontMatter = toFrontMatter(doc.frontMatter);
      const content = `${frontMatter}\n${doc.body}\n`;
      if (!config.dryRun) await fs.writeFile(filePath, content, "utf8");
      written += 1;
      progress("item", `${typeSlug}/${fileName}`);

      if (config.createRedirects && item?.link) report.redirects.push({ from: item.link, to: doc.permalink });

      if (config.downloadMedia && !config.dryRun) {
        const allMediaUrls = extractMediaUrls(item?.content?.rendered || "", ensureTrailingSlash(config.wpBaseUrl));
        if (doc.frontMatter.featuredImage) allMediaUrls.push(doc.frontMatter.featuredImage);
        for (const mediaUrl of allMediaUrls) {
          try {
            const urlObj = new URL(mediaUrl);
            const relPath = urlObj.pathname.replace(/^\/+/, "");
            const outPath = path.join(mediaRoot, ...relPath.split("/").map(sanitizeFileSegment));
            if (!(await fileExists(outPath))) {
              await downloadFile(mediaUrl, outPath, headers);
              progress("item", `media: ${path.basename(outPath)}`);
            }
          } catch (err) {
            report.warnings.push(`Media failed for ${item?.id || "?"}: ${String(err.message || err)}`);
          }
        }
      }
    }
    report.totals[typeSlug] = written;
    progress("ok", `${type} valmis: kirjoitettu ${written} tiedostoa`);
  }

  if (config.createRedirects) {
    const redirectsPath = path.join(root, "redirects.csv");
    const csv = ["source,destination,status", ...report.redirects.map((r) => `${JSON.stringify(r.from)},${JSON.stringify(r.to)},301`)].join("\n");
    if (!config.dryRun) await fs.writeFile(redirectsPath, `${csv}\n`, "utf8");
    report.redirectsPath = redirectsPath;
    progress("ok", `Uudelleenohjaukset: ${report.redirects.length} kpl → redirects.csv`);
  }

  report.finishedAt = new Date().toISOString();
  report.outputRoot = root;
  report.reportPath = path.join(root, "migration-report.json");
  if (!config.dryRun) await fs.writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const totalItems = Object.values(report.totals).reduce((s, n) => s + n, 0);
  progress("ok", `✓ Migraatio valmis — ${totalItems} kohdetta siirretty${config.dryRun ? " (dry run)" : ""}`);
  return report;
}

async function createConfigFromInput(raw = {}) {
  const stamp = nowStamp();
  const preset = ["none", "kadence", "kadence-pro"].includes(String(raw.preset || "none")) ? String(raw.preset || "none") : "none";
  const authMode = ["none", "app-password", "bearer"].includes(String(raw.authMode || "none"))
    ? String(raw.authMode || "none")
    : "none";
  const htmlMode = String(raw.htmlMode || "keep-html") === "basic-markdown" ? "basic-markdown" : "keep-html";
  const outputRoot = String(raw.outputRoot || `./migrations/wp-to-eleventy-${stamp}`).trim() || `./migrations/wp-to-eleventy-${stamp}`;
  const contentTypes = parseCsvList(raw.contentTypes || DEFAULT_TYPES.join(","));
  const presetDefaults = preset === "kadence" ? {
    useNunjucksLayouts: true,
    convertKadenceBlocks: true,
    migrateStyles: true,
    pageLayout: "layouts/page.njk",
    postLayout: "layouts/post.njk",
    kadenceBlocksDir: DEFAULT_KADENCE_BLOCKS_DIR,
    stylesDir: DEFAULT_KADENCE_STYLES_DIR,
    htmlMode: "keep-html"
  } : preset === "kadence-pro" ? {
    useNunjucksLayouts: true,
    convertKadenceBlocks: true,
    migrateStyles: true,
    pageLayout: "layouts/page.njk",
    postLayout: "layouts/post.njk",
    kadenceBlocksDir: DEFAULT_KADENCE_BLOCKS_DIR,
    stylesDir: DEFAULT_KADENCE_PRO_STYLES_DIR,
    htmlMode: "keep-html"
  } : {};

  return {
    preset,
    sourceType: String(raw.sourceType || "rest").toLowerCase(),
    wpBaseUrl: String(raw.wpBaseUrl || "").trim().replace(/\/+$/, ""),
    restNamespace: String(raw.restNamespace || DEFAULT_NAMESPACE).trim() || DEFAULT_NAMESPACE,
    contentTypes: contentTypes.length ? contentTypes : [...DEFAULT_TYPES],
    includeDrafts: Boolean(raw.includeDrafts),
    downloadMedia: Boolean(raw.downloadMedia),
    createRedirects: Boolean(raw.createRedirects ?? true),
    importMenus: Boolean(raw.importMenus ?? true),
    htmlMode: presetDefaults.htmlMode || htmlMode,
    targetPermalinkPattern: String(raw.targetPermalinkPattern || "/{type}/{slug}/").trim() || "/{type}/{slug}/",
    authMode,
    wpUser: String(raw.wpUser || ""),
    wpAppPassword: String(raw.wpAppPassword || ""),
    wpBearerToken: String(raw.wpBearerToken || ""),
    dryRun: Boolean(raw.dryRun ?? true),
    useNunjucksLayouts: Boolean(raw.useNunjucksLayouts ?? presetDefaults.useNunjucksLayouts),
    pageLayout: String(raw.pageLayout || presetDefaults.pageLayout || "layouts/page.njk").trim() || "layouts/page.njk",
    postLayout: String(raw.postLayout || presetDefaults.postLayout || "layouts/post.njk").trim() || "layouts/post.njk",
    defaultLayout: String(raw.defaultLayout || "").trim(),
    convertKadenceBlocks: Boolean(raw.convertKadenceBlocks ?? presetDefaults.convertKadenceBlocks),
    kadenceBlocksDir: String(raw.kadenceBlocksDir || presetDefaults.kadenceBlocksDir || DEFAULT_KADENCE_BLOCKS_DIR).trim() || DEFAULT_KADENCE_BLOCKS_DIR,
    migrateStyles: Boolean(raw.migrateStyles ?? presetDefaults.migrateStyles),
    stylesDir: String(raw.stylesDir || presetDefaults.stylesDir || DEFAULT_STYLES_DIR).trim() || DEFAULT_STYLES_DIR,
    outputRoot,
    contentDir: String(raw.contentDir || "content").trim() || "content",
    mediaDir: String(raw.mediaDir || "media").trim() || "media",
    dataDir: String(raw.dataDir || DEFAULT_DATA_DIR).trim() || DEFAULT_DATA_DIR
  };
}

async function saveConfig(config, configPath) {
  const absolute = path.resolve(process.cwd(), configPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return absolute;
}

function defaultConfigPathFor(outputRoot) {
  return path.join(outputRoot, "migration-config.json");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  let body;
  try {
    body = `${JSON.stringify(payload, null, 2)}\n`;
  } catch {
    body = `${JSON.stringify({ error: "Response serialization failed" })}\n`;
    status = 500;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function extractDeploymentPlan(body) {
  const keys = [
    "localProjectFolder", "localDevCommand", "localSiteUrl",
    "githubOwner", "githubRepo", "pagesUrl", "buildCommand",
    "useGitHubActions", "publishOnPush",
    "useCustomDomain", "domainAction", "desiredDomain", "registrar", "dnsNotes"
  ];
  const plan = {};
  for (const k of keys) if (body[k] !== undefined) plan[k] = body[k];
  return plan;
}

async function serveUi(port = 4173) {
  const indexPath = path.join(UI_ROOT, "index.html");
  const html = await fs.readFile(indexPath, "utf8");
  const jobs = new Map();

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendJson(res, 400, { error: "Missing URL" });
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ping") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/defaults") {
        const stamp = nowStamp();
        const outputRoot = `./migrations/wp-to-eleventy-${stamp}`;
        sendJson(res, 200, {
          sourceType: "rest",
          preset: "none",
          wpBaseUrl: "",
          restNamespace: DEFAULT_NAMESPACE,
          contentTypes: DEFAULT_TYPES.join(","),
          includeDrafts: false,
          downloadMedia: false,
          createRedirects: true,
          importMenus: true,
          htmlMode: "keep-html",
          targetPermalinkPattern: "/{type}/{slug}/",
          authMode: "none",
          wpUser: "",
          wpAppPassword: "",
          wpBearerToken: "",
          dryRun: true,
          useNunjucksLayouts: false,
          pageLayout: "layouts/page.njk",
          postLayout: "layouts/post.njk",
          defaultLayout: "",
          convertKadenceBlocks: false,
          kadenceBlocksDir: DEFAULT_KADENCE_BLOCKS_DIR,
          migrateStyles: false,
          stylesDir: DEFAULT_STYLES_DIR,
          outputRoot,
          contentDir: "content",
          mediaDir: "media",
          dataDir: DEFAULT_DATA_DIR,
          configPath: defaultConfigPathFor(outputRoot)
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/save-config") {
        const body = await readJsonBody(req);
        const config = await createConfigFromInput(body);
        const deploymentPlan = extractDeploymentPlan(body);
        const configPath = String(body.configPath || defaultConfigPathFor(config.outputRoot));
        const absolutePath = await saveConfig(config, configPath);
        if (Object.keys(deploymentPlan).length) {
          const planPath = path.join(path.dirname(absolutePath), "deployment-plan.json");
          await fs.writeFile(planPath, `${JSON.stringify(deploymentPlan, null, 2)}\n`, "utf8");
        }
        sendJson(res, 200, { ok: true, config, configPath: absolutePath });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        const body = await readJsonBody(req);
        const config = await createConfigFromInput(body);
        const deploymentPlan = extractDeploymentPlan(body);
        const configPath = String(body.configPath || defaultConfigPathFor(config.outputRoot));
        const absolutePath = await saveConfig(config, configPath);
        if (!config.dryRun && Object.keys(deploymentPlan).length) {
          const planPath = path.join(path.dirname(absolutePath), "deployment-plan.json");
          await fs.writeFile(planPath, `${JSON.stringify(deploymentPlan, null, 2)}\n`, "utf8");
        }
        const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const log = [];
        const progress = (level, msg) => {
          log.push({ level, msg, t: new Date().toISOString() });
        };
        jobs.set(jobId, { status: "running", log });
        runMigration(absolutePath, config, progress).then((report) => {
          jobs.set(jobId, { status: "done", configPath: absolutePath, report, log });
        }).catch((err) => {
          jobs.set(jobId, { status: "error", error: String(err?.message || err), log });
        });
        sendJson(res, 202, { ok: true, jobId, configPath: absolutePath });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/run/")) {
        const jobId = url.pathname.slice("/api/run/".length);
        const job = jobs.get(jobId);
        if (!job) { sendJson(res, 404, { error: "Job not found" }); return; }
        sendJson(res, 200, job);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { error: String(err?.message || err) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  output.write(`GUI available at http://127.0.0.1:${port}\n`);
}

async function runWizard() {
  const rl = readline.createInterface({ input, output });
  try {
    output.write("\nWordPress -> Eleventy Migration Wizard\n");
    output.write("This wizard asks required migration choices and can run migration immediately.\n");

    const sourceType = (await ask(rl, "Source type (rest/xml/json)", "rest")).toLowerCase();
    const preset = (await ask(rl, "Preset (none/kadence/kadence-pro)", "none")).toLowerCase();
    const wpBaseUrl = await ask(rl, "WordPress base URL (e.g. https://example.com)", "");
    const restNamespace = await ask(rl, "REST namespace path", DEFAULT_NAMESPACE);
    const contentTypes = parseCsvList(await ask(rl, "Content types (comma-separated)", DEFAULT_TYPES.join(",")));
    const includeDrafts = await askYesNo(rl, "Include drafts and private posts", false);
    const downloadMedia = await askYesNo(rl, "Download media files locally", false);
    const createRedirects = await askYesNo(rl, "Generate redirects CSV", true);
    const importMenus = await askYesNo(rl, "Attempt WordPress menu import", true);
    const htmlMode = (await ask(rl, "Content conversion mode (keep-html/basic-markdown)", "keep-html")).toLowerCase();
    const targetPermalinkPattern = await ask(rl, "Target permalink pattern for non-pages", "/{type}/{slug}/");
    const authMode = (await ask(rl, "Auth mode (none/app-password/bearer)", "none")).toLowerCase();

    let wpUser = "";
    let wpAppPassword = "";
    let wpBearerToken = "";
    if (authMode === "app-password") {
      wpUser = await ask(rl, "WP username", "");
      wpAppPassword = await ask(rl, "WP application password", "");
    } else if (authMode === "bearer") {
      wpBearerToken = await ask(rl, "Bearer token", "");
    }

    const dryRun = await askYesNo(rl, "Dry run (no files written)", true);
    const isKadencePreset = preset === "kadence" || preset === "kadence-pro";
    if (isKadencePreset) {
      output.write(`  Preset '${preset}': enables Nunjucks layouts, Kadence block conversion, and style migration.\n`);
    }
    const useNunjucksLayouts = isKadencePreset ? true : await askYesNo(rl, "Add Nunjucks layout fields to front matter", false);
    const convertKadenceBlocks = isKadencePreset ? true : await askYesNo(rl, "Convert supported Kadence blocks into Nunjucks includes", false);
    const migrateStyles = isKadencePreset ? true : await askYesNo(rl, "Download site stylesheets and extract CSS design tokens", false);
    const pageLayout = await ask(rl, "Page layout path", "layouts/page.njk");
    const postLayout = await ask(rl, "Post layout path", "layouts/post.njk");
    const defaultLayout = await ask(rl, "Default layout path for other content types (optional)", "");
    const kadenceBlocksDir = await ask(rl, "Kadence partial output directory", DEFAULT_KADENCE_BLOCKS_DIR);
    const defaultStylesDir = preset === "kadence-pro" ? DEFAULT_KADENCE_PRO_STYLES_DIR : isKadencePreset ? DEFAULT_KADENCE_STYLES_DIR : DEFAULT_STYLES_DIR;
    const stylesDir = await ask(rl, "Styles output directory", defaultStylesDir);
    const stamp = nowStamp();
    const outputRoot = await ask(rl, "Output root", `./migrations/wp-to-eleventy-${stamp}`);
    const contentDir = await ask(rl, "Content subdirectory", "content");
    const mediaDir = await ask(rl, "Media subdirectory", "media");
    const dataDir = await ask(rl, "Data subdirectory for navigation/menu JSON", DEFAULT_DATA_DIR);
    const configPath = await ask(rl, "Config file path", path.join(outputRoot, "migration-config.json"));

    const config = await createConfigFromInput({
      sourceType,
      preset,
      wpBaseUrl,
      restNamespace,
      contentTypes: contentTypes.join(","),
      includeDrafts,
      downloadMedia,
      createRedirects,
      importMenus,
      htmlMode,
      targetPermalinkPattern,
      authMode,
      wpUser,
      wpAppPassword,
      wpBearerToken,
      dryRun,
      useNunjucksLayouts,
      convertKadenceBlocks,
      migrateStyles,
      pageLayout,
      postLayout,
      defaultLayout,
      kadenceBlocksDir,
      stylesDir,
      outputRoot,
      contentDir,
      mediaDir,
      dataDir
    });

    await saveConfig(config, configPath);
    output.write(`\nConfig saved: ${configPath}\n`);

    output.write("\nRecommended flow:\n");
    output.write("1. Run dry-run first and inspect migration-report.json.\n");
    output.write("2. Validate permalink mapping and redirects.csv.\n");
    output.write("3. Re-run with dryRun=false and review generated content.\n");

    const runNow = await askYesNo(rl, "Run migration now", true);
    if (!runNow) return;

    const report = await runMigration(path.resolve(process.cwd(), configPath), config);
    output.write("\nMigration finished.\n");
    output.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    rl.close();
  }
}

async function runFromConfig(configPath) {
  const absolute = path.resolve(process.cwd(), configPath);
  const report = await runMigration(absolute);
  output.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || cmd === "wizard") {
    await runWizard();
    return;
  }
  if (cmd === "run") {
    if (!arg) {
      output.write("Usage: node scripts/wp-eleventy-migrate.mjs run <config.json>\n");
      process.exitCode = 1;
      return;
    }
    await runFromConfig(arg);
    return;
  }
  if (cmd === "serve") {
    const port = arg ? Number.parseInt(arg, 10) : 4173;
    await serveUi(Number.isFinite(port) ? port : 4173);
    return;
  }
  output.write("Usage:\n");
  output.write("  node scripts/wp-eleventy-migrate.mjs wizard\n");
  output.write("  node scripts/wp-eleventy-migrate.mjs run <config.json>\n");
  output.write("  node scripts/wp-eleventy-migrate.mjs serve [port]\n");
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
