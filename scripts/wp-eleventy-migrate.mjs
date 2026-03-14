#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import http from "node:http";
import readline from "node:readline/promises";
import { execFile, spawn } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_TYPES = ["posts", "pages"];
const DEFAULT_NAMESPACE = "/wp-json/wp/v2";
const DEFAULT_DATA_DIR = "_data";
const DEFAULT_KADENCE_BLOCKS_DIR = "_includes/blocks/kadence";
const DEFAULT_STYLES_DIR = "styles/legacy";
const DEFAULT_KADENCE_STYLES_DIR = "styles/kadence-legacy";
const DEFAULT_KADENCE_PRO_STYLES_DIR = "styles/kadence-pro-legacy";
const PROFILE_FILE_NAME = "site-profile.json";
const PROFILE_SUMMARY_FILE_NAME = "site-profile-summary.json";
const CONFIGURE_THEME_FILE = "styles/theme.css";
const SUPPORTED_KADENCE_BLOCKS = [
  "advancedheading",
  "advancedbtn",
  "singlebtn",
  "rowlayout",
  "column",
  "image",
  "gallery",
  "slider",
  "slide",
  "tabs",
  "tab",
  "accordion",
  "pane",
  "infobox",
  "icon",
  "iconlist",
  "listitem",
  "spacer",
  "posts",
  "postgrid",
  "query",
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
  singlebtn:            { wrap: "kb-btn-wrap" },
  rowlayout:            { wrap: "kb-row-layout-wrap",        uid: "kb-row-layout-id" },
  column:               { wrap: "kb-section-container",     uid: "kb-section" },
  image:                { wrap: "kb-image-wrap" },
  gallery:              { wrap: "kb-gallery-wrap",           uid: "kb-gallery-id" },
  slider:               { wrap: "kb-slider-wrap",            uid: "kb-slider-id" },
  slide:                { wrap: "kb-slide-item" },
  tabs:                 { wrap: "kb-tabs",                   uid: "kb-tabs-id" },
  tab:                  { wrap: "kb-tab-panel" },
  accordion:            { wrap: "kb-accordion",              uid: "kb-accordion-id" },
  pane:                 { wrap: "kb-accordion-pane" },
  infobox:              { wrap: "kt-blocks-info-box-wrap",   uid: "kt-info-box" },
  icon:                 { wrap: "kb-svg-icon-wrap" },
  iconlist:             { wrap: "kb-icon-list",              uid: "kb-icon-list-id" },
  listitem:             { wrap: "kb-icon-list-item" },
  spacer:               { wrap: "kt-block-spacer",           uid: "kt-block-spacer-id" },
  posts:                { wrap: "kb-posts" },
  postgrid:             { wrap: "kb-post-grid" },
  query:                { wrap: "kb-query-loop" },
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
const SEPARATOR_SVG_TEMPLATES = {
  // Generic Eleventy-migrator shapes
  mtns:       `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><path fill="currentColor" d="M0,96L80,80C160,64,320,32,480,32C640,32,800,64,960,74.7C1120,85,1280,75,1360,69.3L1440,64L1440,160L1360,160C1280,160,1120,160,960,160C800,160,640,160,480,160C320,160,160,160,80,160L0,160Z"/></svg>`,
  waves:      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><path fill="currentColor" d="M0,128L48,122.7C96,117,192,107,288,85.3C384,64,480,32,576,32C672,32,768,64,864,80C960,96,1056,96,1152,80C1248,64,1344,32,1392,16L1440,0L1440,160L1392,160C1344,160,1248,160,1152,160C1056,160,960,160,864,160C768,160,672,160,576,160C480,160,384,160,288,160C192,160,96,160,48,160L0,160Z"/></svg>`,
  tilt:       `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><polygon fill="currentColor" points="0,0 1440,96 1440,160 0,160"/></svg>`,
  curve:      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><path fill="currentColor" d="M0,128C180,85,360,64,540,74.7C720,85,900,128,1080,133.3C1260,139,1350,107,1440,80L1440,160L0,160Z"/></svg>`,
  triangle:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><polygon fill="currentColor" points="0,160 720,0 1440,160"/></svg>`,
  // Kadence-specific separator shapes
  ct:         `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><path fill="currentColor" d="M0,160L0,80Q360,0,720,0Q1080,0,1440,80L1440,160Z"/></svg>`,
  cti:        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><path fill="currentColor" d="M0,160L0,0Q360,160,720,160Q1080,160,1440,0L1440,160Z"/></svg>`,
  ctdi:       `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><path fill="currentColor" d="M0,160L0,96Q360,0,720,0Q1080,0,1440,96L1440,160Z M0,160L0,128Q360,64,720,64Q1080,64,1440,128L1440,160Z"/></svg>`,
  threelevels:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 160" preserveAspectRatio="none"><polygon fill="currentColor" points="0,160 0,96 480,96 480,64 960,64 960,32 1440,32 1440,160"/></svg>`
};

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

function localizeSiteUrl(rawUrl, wpBaseUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const resolved = new URL(value, ensureTrailingSlash(wpBaseUrl));
    const wpOrigin = new URL(wpBaseUrl).origin;
    if (resolved.origin !== wpOrigin) return resolved.toString();
    return normalizePathnameToPermalink(resolved.pathname || "/");
  } catch {
    if (/^(#|mailto:|tel:)/i.test(value)) return value;
    return value.startsWith("/") ? normalizePathnameToPermalink(value) : value;
  }
}

function normalizeMenuItems(items = [], wpBaseUrl = "") {
  return items.map((item) => ({
    id: item?.id ?? item?.ID ?? `${menuItemOrder(item)}-${slugify(menuItemLabel(item))}`,
    parent: menuItemParent(item),
    title: menuItemLabel(item),
    url: localizeSiteUrl(menuItemUrl(item), wpBaseUrl),
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

function normalizeMenuRecord(menu, items, wpBaseUrl = "") {
  const title = decodeHtml(menu?.name || menu?.title?.rendered || menu?.title || menu?.slug || "menu");
  const slug = slugify(menu?.slug || menu?.name || menu?.title?.rendered || menu?.title || "menu");
  const normalizedItems = normalizeMenuItems(items, wpBaseUrl);
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
    resolved.push(normalizeMenuRecord(detail, items, wpBaseUrl));
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
      resolved.push(normalizeMenuRecord(menu, items, wpBaseUrl));
      continue;
    }
    const detailUrl = joinUrl(wpBaseUrl, `/wp-json/wp-api-menus/v2/menus/${menu.id}`);
    const detail = await fetchJson(detailUrl, headers);
    resolved.push(normalizeMenuRecord(detail, Array.isArray(detail?.items) ? detail.items : [], wpBaseUrl));
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
    const menuItems = items.filter((item) => {
      const menusValue = item?.menus;
      const menuRefs = Array.isArray(menusValue)
        ? menusValue
        : menusValue === undefined || menusValue === null
          ? []
          : [menusValue];
      return menuRefs.includes(menuId) || item?.menu === menuId;
    });
    return normalizeMenuRecord(menu, menuItems, wpBaseUrl);
  }).filter((menu) => menu.items.length > 0);
}

// ── Kadence navigation-link block parser ──────────────────────────────────────

function parseKadenceNavLinks(content, wpBaseUrl = "") {
  const tree = parseWpBlocks(content || "");
  return extractNavLinkNodes(tree, wpBaseUrl);
}

function extractNavLinkNodes(nodes, wpBaseUrl) {
  const items = [];
  for (const node of nodes) {
    if (!node || node.type === "html") continue;
    if (node.name === "kadence/navigation" || node.name === "kadence/navigation-link" && false) {
      items.push(...extractNavLinkNodes(node.children || [], wpBaseUrl));
    } else if (node.name === "kadence/navigation-link") {
      const attrs = node.attrs || {};
      const rawUrl = String(attrs.url || "#");
      const url = wpBaseUrl ? rawUrl.replace(wpBaseUrl, "") || "/" : rawUrl;
      const item = {
        label: String(attrs.label || ""),
        url,
        isMegaMenu: Boolean(attrs.isMegaMenu),
        target: attrs.target || "",
        megamenuColumns: [],
        children: [],
      };
      if (attrs.isMegaMenu && node.children && node.children.length) {
        item.megamenuColumns = extractMegamenuColumns(node.children, wpBaseUrl);
      } else if (node.children && node.children.length) {
        item.children = extractNavLinkNodes(node.children, wpBaseUrl);
      }
      items.push(item);
    } else if (node.name === "kadence/navigation") {
      items.push(...extractNavLinkNodes(node.children || [], wpBaseUrl));
    } else if (node.children && node.children.length) {
      items.push(...extractNavLinkNodes(node.children, wpBaseUrl));
    }
  }
  return items;
}

function extractMegamenuColumns(nodes, wpBaseUrl) {
  const columns = [];
  for (const node of nodes) {
    if (!node || node.type === "html") continue;
    if (node.name === "kadence/rowlayout") {
      for (const child of node.children || []) {
        if (child.name === "kadence/column") {
          const colItems = extractNavLinkNodes(child.children || [], wpBaseUrl);
          if (colItems.length) columns.push({ items: colItems });
        }
      }
    }
  }
  return columns;
}

async function fetchKadenceNavigations(config, headers) {
  const baseApi = `${config.wpBaseUrl}${config.restNamespace || "/wp-json/wp/v2"}`;
  try {
    const url = `${baseApi}/kadence_navigation?per_page=100&context=edit`;
    const items = await fetchAllPages(url, headers);
    return items.map((item) => ({
      id: item.id,
      title: String(item.title?.rendered || item.title?.raw || ""),
      content: String(item.content?.raw || item.content?.rendered || ""),
    }));
  } catch {
    return [];
  }
}

async function fetchKadenceHeaders(config, headers) {
  const baseApi = `${config.wpBaseUrl}${config.restNamespace || "/wp-json/wp/v2"}`;
  try {
    const url = `${baseApi}/kadence_header?per_page=20&context=edit`;
    const items = await fetchAllPages(url, headers);
    return items.map((item) => {
      const content = String(item.content?.raw || item.content?.rendered || "");
      const meta = item.meta || {};
      return {
        id: item.id,
        title: String(item.title?.rendered || item.title?.raw || ""),
        content,
        styles: parseKadenceHeaderStyles(content, meta),
      };
    });
  } catch {
    return [];
  }
}

// Parse visual styles from a kadence_header block tree (header-row attributes)
// and optionally merge REST meta fields (which take priority)
function parseKadenceHeaderStyles(content, meta = {}) {
  const tree = parseWpBlocks(content);
  const styles = {
    minHeight: null,
    background: null,
    backgroundType: null,
    backgroundImg: null,
    isTransparent: false,
    isTransparentTablet: false,
    isTransparentMobile: false,
    isSticky: false,
    isStickyTablet: false,
    isStickyMobile: false,
    stickySection: null,
    stickySectionTablet: null,
    logoWidth: null,
    logoIsLink: true,
    logoShowTitle: true,
    logoLayout: null,
  };

  // Walk block tree for header-row minHeight and logo settings
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type === "block" && node.name === "kadence/header-row") {
        const a = node.attrs || {};
        if (a.minHeight != null && styles.minHeight == null) styles.minHeight = a.minHeight;
        // Block attrs as fallback if meta missing
        if (a.background && styles.background == null) styles.background = a.background;
        if (a.backgroundType && styles.backgroundType == null) styles.backgroundType = a.backgroundType;
        if (a.backgroundImg && styles.backgroundImg == null) styles.backgroundImg = a.backgroundImg;
      }
      if (node.type === "block" && node.name === "kadence/identity") {
        const a = node.attrs || {};
        if (a.showSiteTitle != null && styles.logoShowTitle === true) styles.logoShowTitle = a.showSiteTitle;
        if (a.layout && styles.logoLayout == null) styles.logoLayout = a.layout;
      }
      if (node.type === "block" && node.name === "site-logo") {
        const a = node.attrs || {};
        if (a.width != null && styles.logoWidth == null) styles.logoWidth = a.width;
        if (a.isLink === false) styles.logoIsLink = false;
      }
      if (node.children && node.children.length) walk(node.children);
    }
  }
  walk(tree.children || []);

  // Meta fields override block attrs (more authoritative)
  const bg = meta._kad_header_background;
  if (bg) {
    if (bg.color) styles.background = bg.color;
    if (bg.type) styles.backgroundType = bg.type;
    if (bg.image) styles.backgroundImg = [{ bgImg: bg.image, bgPosition: bg.position || "center center", bgSize: bg.size || "cover", bgRepeat: bg.repeat || "no-repeat" }];
  }
  if (meta._kad_header_isTransparent === "1" || meta._kad_header_isTransparent === true) styles.isTransparent = true;
  if (meta._kad_header_isTransparentTablet === "1" || meta._kad_header_isTransparentTablet === true) styles.isTransparentTablet = true;
  if (meta._kad_header_isTransparentMobile === "1" || meta._kad_header_isTransparentMobile === true) styles.isTransparentMobile = true;
  if (meta._kad_header_isSticky === "1" || meta._kad_header_isSticky === true) styles.isSticky = true;
  if (meta._kad_header_isStickyTablet === "1" || meta._kad_header_isStickyTablet === true) styles.isStickyTablet = true;
  if (meta._kad_header_isStickyMobile === "1" || meta._kad_header_isStickyMobile === true) styles.isStickyMobile = true;
  if (meta._kad_header_stickySection) styles.stickySection = meta._kad_header_stickySection;
  if (meta._kad_header_stickySectionTablet) styles.stickySectionTablet = meta._kad_header_stickySectionTablet;

  return styles;
}

// Find the first navigation id referenced in a kadence_header block tree
function findNavIdInHeaderContent(content) {
  const navRe = /<!--\s*wp:kadence\/navigation\s+({[^}]*})/g;
  let m;
  while ((m = navRe.exec(content)) !== null) {
    try {
      const attrs = JSON.parse(m[1]);
      if (attrs.id) return attrs.id;
    } catch { /* skip */ }
  }
  return null;
}

// Merge kadence navigation megamenu data into an existing navigation.json menu array
function mergeKadenceMegamenuIntoNav(navMenus, kadenceNavItems) {
  if (!navMenus || !navMenus.length || !kadenceNavItems || !kadenceNavItems.length) return navMenus;
  const normalizeUrl = (u) => String(u || "").replace(/\/+$/, "").toLowerCase().split("?")[0];

  for (const menu of navMenus) {
    if (!menu.items) continue;
    for (const item of menu.items) {
      const matchingKnItem = kadenceNavItems.find(
        (kn) => normalizeUrl(kn.url) === normalizeUrl(item.url) || kn.label === item.title
      );
      if (matchingKnItem && matchingKnItem.isMegaMenu && matchingKnItem.megamenuColumns.length) {
        item.megamenu = true;
        item.megamenuColumns = matchingKnItem.megamenuColumns;
      }
    }
  }
  return navMenus;
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

function buildAuthHeaders(config, progress = () => {}) {
  const headers = {};
  if (config.authMode === "app-password" && config.wpUser && config.wpAppPassword) {
    const token = Buffer.from(`${config.wpUser}:${config.wpAppPassword}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
    progress("ok", "Autentikointi: app-password");
  } else if (config.authMode === "bearer" && config.wpBearerToken) {
    headers.Authorization = `Bearer ${config.wpBearerToken}`;
    progress("ok", "Autentikointi: bearer token");
  }
  return headers;
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

function mergeCounter(target, additions) {
  for (const [key, value] of Object.entries(additions || {})) {
    target[key] = (target[key] || 0) + Number(value || 0);
  }
  return target;
}

function uniqueSorted(values) {
  const list = Array.isArray(values)
    ? values
    : values && typeof values[Symbol.iterator] === "function"
      ? [...values]
      : [];
  return [...new Set(list.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function extractPaletteFromVariables(variableMap = {}) {
  const palette = {};
  for (const [name, value] of Object.entries(variableMap)) {
    const match = String(name).match(/^--global-palette([1-9])$/);
    if (!match) continue;
    palette[`palette${match[1]}`] = String(value || "").trim();
  }
  return palette;
}

function summarizeKnownVsUnknownBlocks(blocksUsed = {}) {
  const supported = new Set([
    ...SUPPORTED_KADENCE_BLOCKS.map((name) => `kadence/${name}`),
    ...SUPPORTED_KADENCE_PRO_BLOCKS.map((name) => `kadence/${name}`)
  ]);
  let known = 0;
  let unknown = 0;
  const unknownBlocks = [];
  for (const [name, count] of Object.entries(blocksUsed)) {
    if (!name.startsWith("kadence/")) continue;
    if (supported.has(name)) known += count;
    else {
      unknown += count;
      unknownBlocks.push(name);
    }
  }
  return { known, unknown, unknownBlocks: uniqueSorted(unknownBlocks) };
}

function collectBlockProfile(nodes, profile, pathname = "/") {
  for (const node of nodes || []) {
    if (node?.type !== "block") continue;
    const blockName = String(node.name || "").trim();
    if (blockName) {
      profile.blocksUsed[blockName] = (profile.blocksUsed[blockName] || 0) + 1;
      if (blockName === "kadence/rowlayout") {
        const attrs = node.attrs || {};
        if (attrs.colLayout) profile.colLayouts.add(String(attrs.colLayout));
        if (attrs.bottomSep) profile.separatorsUsed.add(String(attrs.bottomSep));
        if (attrs.topSep) profile.separatorsUsed.add(String(attrs.topSep));
        if (attrs.align === "full" || attrs.backgroundImg || attrs.bgColor || attrs.bgColorClass) {
          profile.heroPages.add(pathname);
        }
      } else if (blockName === "kadence/advancedheading") {
        const attrs = node.attrs || {};
        if (attrs.color) profile.headingColors.add(String(attrs.color));
        if (attrs.fontSize) profile.headingSizes.add(String(attrs.fontSize));
      } else if (blockName === "kadence/advancedbtn") {
        const attrs = node.attrs || {};
        const btnKey = JSON.stringify({
          hAlign: attrs.hAlign || "",
          size: attrs.size || "",
          style: attrs.btnStyle || attrs.style || "",
          className: attrs.className || ""
        });
        profile.buttonStyles.add(btnKey);
      }
    }
    collectBlockProfile(node.children || [], profile, pathname);
  }
}

async function discoverContentProfile(baseApi, headers, progress, warnings) {
  const profile = {
    blocksUsed: {},
    separatorsUsed: new Set(),
    colLayouts: new Set(),
    heroPages: new Set(),
    headingColors: new Set(),
    headingSizes: new Set(),
    buttonStyles: new Set(),
    scannedTypes: []
  };

  for (const type of DEFAULT_TYPES) {
    try {
      progress("info", `DISCOVER: skannataan ${type}-lohkorakenne…`);
      const items = await fetchAllPages(`${baseApi}/${type}?context=edit&_embed=1`, headers);
      profile.scannedTypes.push(type);
      for (const item of items) {
        const rawContent = String(item?.content?.raw || "");
        if (!rawContent) continue;
        const pathname = (() => {
          try {
            return normalizePathnameToPermalink(new URL(item?.link || "/").pathname || "/");
          } catch {
            return "/";
          }
        })();
        collectBlockProfile(parseWpBlocks(rawContent), profile, pathname);
      }
      progress("ok", `DISCOVER: ${type} skannattu (${items.length} kohdetta)`);
    } catch (err) {
      warnings.push(`Block discovery for ${type} failed: ${String(err.message || err)}`);
      progress("warn", `DISCOVER: ${type}-lohkoja ei saatu skannattua`);
    }
  }

  return {
    blocksUsed: profile.blocksUsed,
    separatorsUsed: uniqueSorted(profile.separatorsUsed),
    colLayouts: uniqueSorted(profile.colLayouts),
    heroPages: uniqueSorted(profile.heroPages),
    headingColors: uniqueSorted(profile.headingColors),
    headingSizes: uniqueSorted(profile.headingSizes),
    buttonStyles: [...profile.buttonStyles].map((entry) => JSON.parse(entry)),
    scannedTypes: profile.scannedTypes
  };
}

function buildConfigureSummary(siteProfile) {
  const coverage = summarizeKnownVsUnknownBlocks(siteProfile.blocksUsed);
  return {
    paletteDetected: Object.keys(siteProfile.palette || {}).length,
    separatorsGenerated: (siteProfile.separatorsUsed || []).length,
    layoutsDetected: (siteProfile.colLayouts || []).length,
    knownBlocks: coverage.known,
    unknownBlocks: coverage.unknown,
    unknownBlockTypes: coverage.unknownBlocks
  };
}

async function writeSiteProfileArtifacts(outputRoot, profile, progress = () => {}) {
  if (!outputRoot || !profile) return {};
  const absoluteRoot = path.resolve(process.cwd(), outputRoot);
  await fs.mkdir(absoluteRoot, { recursive: true });
  const profilePath = path.join(absoluteRoot, PROFILE_FILE_NAME);
  const summaryPath = path.join(absoluteRoot, PROFILE_SUMMARY_FILE_NAME);
  const configureSummary = buildConfigureSummary(profile);
  await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await fs.writeFile(summaryPath, `${JSON.stringify(configureSummary, null, 2)}\n`, "utf8");
  progress("ok", `DISCOVER: profiili tallennettu (${PROFILE_FILE_NAME})`);
  return { profilePath, summaryPath, configureSummary };
}

function themeCssFromProfile(profile) {
  const paletteEntries = Object.entries(profile?.palette || {});
  const hs = profile?.headerStyles || {};

  // Resolve background for .site-shell-header
  let headerBg = "var(--global-palette9, #fff)";
  if (hs.backgroundType === "image" && Array.isArray(hs.backgroundImg) && hs.backgroundImg[0]?.bgImg) {
    const img = hs.backgroundImg[0];
    const position = img.bgPosition || "center center";
    const size = img.bgSize || "cover";
    const repeat = img.bgRepeat || "no-repeat";
    headerBg = `url('${img.bgImg}') ${position} / ${size} ${repeat}`;
  } else if (hs.background) {
    // Kadence stores palette refs as "palette9" — map to CSS var, or use as-is if already a value
    headerBg = /^palette\d+$/.test(hs.background)
      ? `var(--global-${hs.background}, #fff)`
      : hs.background;
  }

  const headerMinHeight = hs.minHeight ? `${hs.minHeight}px` : "64px";
  const logoWidth = hs.logoWidth ? `${hs.logoWidth}px` : "120px";

  return [
    "/* Auto-generated by wp-eleventy-migrator from site-profile.json */",
    ":root {",
    ...paletteEntries.map(([token, value]) => `  --global-${token}: ${value};`),
    "}",
    "",
    "/* ── Shell layout ──────────────────────────────────────────────────────────── */",
    "*, *::before, *::after { box-sizing: border-box; }",
    "body { margin: 0; font-family: var(--global-body-font-family, Arial, Helvetica, sans-serif); }",
    "",
    "/* ── Site header ───────────────────────────────────────────────────────────── */",
    `.site-shell-header { position: sticky; top: 0; z-index: 1000; background: ${headerBg}; transition: background 0.3s; }`,
    `.site-shell-header.is-transparent { background: transparent; }`,
    `.site-shell-header.is-stuck { background: ${headerBg}; }`,
    `.site-header-inner { display: flex; align-items: center; gap: 1rem; max-width: var(--global-content-width, 1290px); margin: 0 auto; padding: var(--global-kb-spacing-sm, 1.5rem); min-height: ${headerMinHeight}; }`,
    ".site-logo { text-decoration: none; color: var(--global-palette1, #333); font-weight: 700; font-size: 1.1rem; white-space: nowrap; flex-shrink: 0; }",
    `.site-logo img { width: ${logoWidth}; height: auto; display: block; }`,
    "",
    "/* ── Hamburger toggle — hidden on desktop ──────────────────────────────────── */",
    ".kb-nav-toggle { display: none; background: var(--global-palette7, #f0f4ec); border: 1px solid var(--global-palette6, #446d33); border-radius: 10px; cursor: pointer; font-size: 1.5rem; padding: 0.25rem 0.5rem; color: var(--global-palette3, #000); margin-left: auto; }",
    ".kb-nav-toggle:hover { background: var(--global-palette9, #fff); }",
    "",
    "/* ── Primary nav — desktop ─────────────────────────────────────────────────── */",
    ".site-navigation { margin-left: auto; }",
    ".kb-nav-menu { display: flex; align-items: center; list-style: none; margin: 0; padding: 0; gap: 0; }",
    ".kb-nav-item { position: relative; }",
    ".kb-nav-link { display: block; padding: 0.5rem 0.85rem; text-decoration: none; color: var(--global-palette4, #314e25); font-weight: inherit; white-space: nowrap; transition: color 0.15s, background 0.15s; }",
    ".kb-nav-link:hover { color: var(--global-palette1, #314e25); background: #d9e3cf; }",
    "",
    "/* ── Normal dropdown ───────────────────────────────────────────────────────── */",
    ".menu-item-has-children > .sub-menu { display: none; }",
    ".menu-item-has-children:hover > .sub-menu, .menu-item-has-children.is-open > .sub-menu { display: block; position: absolute; top: 100%; left: 0; min-width: 200px; background: var(--global-palette9, #fff); border: 1px solid #d9e3cf; border-radius: 0 0 20px 20px; box-shadow: 0px 2px 13px 0px rgba(0,0,0,.1); z-index: 200; list-style: none; margin: 0; padding: .25rem 0; }",
    ".kb-nav-sub-menu .menu-item + .menu-item { border-top: 1px solid #d9e3cf; }",
    ".kb-nav-sub-menu .kb-nav-link { padding: .4rem 1rem; }",
    ".kb-nav-sub-menu .menu-item:hover > .kb-nav-link { background: var(--global-palette7, #f0f4ec); }",
    "",
    "/* ── Megamenu ──────────────────────────────────────────────────────────────── */",
    ".kb-nav-mega-menu-item > .kb-mega-menu { display: none; }",
    ".kb-nav-mega-menu-item:hover > .kb-mega-menu, .kb-nav-mega-menu-item.is-open > .kb-mega-menu { display: block; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); width: 700px; background: var(--global-palette9, #fff); border: 1px solid #d9e3cf; border-radius: 0 0 20px 20px; box-shadow: 0px 2px 13px 0px rgba(0,0,0,.1); z-index: 200; padding: 1rem; }",
    ".kb-mega-menu-cols { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1rem; list-style: none; margin: 0; padding: 0; }",
    ".kb-mega-menu-col { flex: 1; }",
    ".kb-mega-col-items { list-style: none; margin: 0; padding: 0; }",
    ".kb-mega-link { display: block; padding: .35rem .5rem; text-decoration: none; color: var(--global-palette1, #333); transition: background .15s; }",
    ".kb-mega-link:hover { background: var(--global-palette7, #f0f4ec); }",
    "",
    "/* ── Feather icons ─────────────────────────────────────────────────────────── */",
    ".feather-icon { display: inline-flex; align-items: center; flex-shrink: 0; }",
    ".feather-icon svg { width: 1em; height: 1em; vertical-align: middle; }",
    ".kt-svg-icon-list-item-wrap { display: flex; align-items: flex-start; gap: .5em; }",
    ".kt-svg-icon-list-text { flex: 1; }",
    "",
    "/* ── Page layout — CSS grid for alignfull breakout ─────────────────────────── */",
    ".page { margin: 0; }",
    ".page-content { display: grid; grid-template-columns: [full-start] minmax(0, 1fr) [content-start] min(var(--global-content-width, 1290px), calc(100% - 2 * var(--global-content-edge-padding, 1.5rem))) [content-end] minmax(0, 1fr) [full-end]; }",
    ".page-content > * { grid-column: content; }",
    ".page-content > .alignfull, .page-content > .alignwide { grid-column: full; }",
    "",
    "/* ── Kadence rowlayout column grid ─────────────────────────────────────────── */",
    ".kt-row-column-wrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--global-row-gutter-md, 2rem); position: relative; z-index: 1; }",
    ".alignfull > .kt-row-column-wrap { padding-left: var(--global-content-edge-padding, 1.5rem); padding-right: var(--global-content-edge-padding, 1.5rem); max-width: var(--global-content-width, 1290px); margin-left: auto; margin-right: auto; }",
    ".kb-row-layout-wrap { position: relative; }",
    ".kt-row-layout-overlay { position: absolute; inset: 0; pointer-events: none; }",
    "@media (min-width: 768px) {",
    "  .kt-row-column-wrap:has(> .wp-block-kadence-column:nth-child(2)) { grid-template-columns: repeat(2, minmax(0, 1fr)); }",
    "  .kt-row-column-wrap.kb-layout-left-golden:has(> .wp-block-kadence-column:nth-child(2)) { grid-template-columns: 2fr 1fr; }",
    "  .kt-row-column-wrap.kb-layout-right-golden:has(> .wp-block-kadence-column:nth-child(2)) { grid-template-columns: 1fr 2fr; }",
    "}",
    "@media (min-width: 1025px) {",
    "  .kt-row-column-wrap:has(> .wp-block-kadence-column:nth-child(3)) { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
    "  .kt-row-column-wrap:has(> .wp-block-kadence-column:nth-child(4)) { grid-template-columns: repeat(4, minmax(0, 1fr)); }",
    "}",
    "",
    "/* ── Separator SVGs — override migrated Kadence CSS fill: #fff ──────────────── */",
    ".kt-row-layout-bottom-sep svg, .kt-row-layout-top-sep svg, .kt-svg-for-top-sep svg, .kt-svg-for-bottom-sep svg { fill: currentColor !important; display: block; width: 100%; height: 100%; }",
    "",
    "/* ── Kadence tabs ───────────────────────────────────────────────────────────── */",
    ".wp-block-kadence-tabs.kb-tabs { margin: 1.5rem 0; }",
    ".kt-tabs-title-list { display: flex; flex-wrap: wrap; list-style: none; margin: 0; padding: 0; gap: .25rem; border-bottom: 2px solid var(--global-palette7, #eee); }",
    ".kt-title-item { margin: 0; }",
    ".kt-tab-title { display: block; padding: .6rem 1.25rem; text-decoration: none; border-radius: 4px 4px 0 0; border: 1px solid transparent; border-bottom: none; color: var(--global-palette3, #000); font-weight: 500; font-size: .95rem; transition: background .15s, color .15s; }",
    ".kt-tab-title:hover { background: var(--global-palette7, #f0f4ec); }",
    ".kt-title-item.kt-tab-title-active .kt-tab-title { background: var(--global-palette9, #fff); border-color: var(--global-palette7, #eee); color: var(--global-palette2, #446d33); font-weight: 700; margin-bottom: -2px; }",
    ".kt-tabs-content-wrap { padding: 1.5rem 0 0; }",
    ".kb-tab-panel { display: none; }",
    ".kb-tab-panel.kt-tab-active { display: block; }",
    "",
    "/* ── Kadence query grid ──────────────────────────────────────────────────────── */",
    ".wp-block-kadence-query.kb-query-loop { margin: 1rem 0; }",
    ".kb-query-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.5rem; }",
    ".kb-query-hidden { display: none; }",
    ".kb-query-sentinel { height: 1px; }",
    ".kb-query-item { background: var(--global-palette9, #fff); border: 1px solid var(--global-palette7, #eee); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }",
    ".kb-query-item__thumb img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }",
    ".kb-query-item__body { padding: 1rem; display: flex; flex-direction: column; flex: 1; }",
    ".kb-query-item__cats { margin-bottom: .4rem; }",
    ".kb-query-item__cat { display: inline-block; font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--global-palette2, #446d33); background: var(--global-palette7, #f0f4ec); padding: .15rem .5rem; border-radius: 3px; }",
    ".kb-query-item__title { font-size: 1rem; margin: 0 0 .4rem; line-height: 1.35; }",
    ".kb-query-item__title a { color: var(--global-palette3, #000); text-decoration: none; }",
    ".kb-query-item__title a:hover { color: var(--global-palette2, #446d33); }",
    ".kb-query-item__date { font-size: .8rem; color: #666; display: block; margin-bottom: .5rem; }",
    ".kb-query-item__excerpt { font-size: .875rem; color: #444; margin: 0; line-height: 1.5; flex: 1; }",
    "",
    "/* ── Kadence accordion ──────────────────────────────────────────────────────── */",
    ".kt-accordion-pane { border: 1px solid var(--global-palette7, #eee); border-radius: 4px; margin-bottom: .5rem; overflow: hidden; }",
    ".kt-accordion-header-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; background: var(--global-palette7, #f0f4ec); border: none; padding: 1rem 1.25rem; cursor: pointer; font-size: 1.05rem; font-weight: 600; text-align: left; gap: .5rem; color: var(--global-palette3, #000); }",
    ".kt-accordion-header-btn:hover { background: var(--global-palette6, #446d33); color: var(--global-palette9, #fff); }",
    ".kt-blocks-accordion-title { flex: 1; line-height: 1.35; white-space: normal; }",
    ".kt-accordion-icon-trigger { display: inline-flex; align-items: center; font-size: 1.25rem; transition: transform .2s; line-height: 1; flex-shrink: 0; }",
    ".kt-accordion-icon-trigger::after { content: '+'; }",
    ".kt-accordion-pane.is-open .kt-accordion-icon-trigger::after { content: '\\2212'; }",
    ".kt-accordion-panel { display: none; }",
    ".kt-accordion-pane.is-open .kt-accordion-panel { display: block; }",
    ".kt-accordion-panel-inner { padding: 1rem; }",
    "",
    "/* ── Kadence infobox ────────────────────────────────────────────────────────── */",
    ".kt-blocks-info-box-wrap { }",
    ".kt-blocks-info-box-link-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 1rem; text-decoration: none; color: inherit; }",
    ".kt-blocks-info-box-media-container { flex-shrink: 0; }",
    ".kt-info-svg-div { display: inline-flex; align-items: center; }",
    ".kt-info-svg-div svg { width: 2rem; height: 2rem; }",
    ".kt-info-box-img-wrap img { max-width: 100%; display: block; }",
    ".kt-infobox-textcontent { flex: 1; display: flex; flex-direction: column; }",
    ".kt-blocks-info-box-title { margin: 0 0 .5rem; }",
    ".kt-blocks-info-box-body { }",
    "",
    "/* ── Kadence infobox — person cards inside accordion + row grid ─────────────── */",
    ".kt-accordion-panel .kt-row-column-wrap { align-items: stretch; }",
    ".kt-accordion-panel .kt-row-column-wrap .wp-block-kadence-column,",
    ".kt-accordion-panel .kt-row-column-wrap .kt-inside-inner-col { height: 100%; display: flex; flex-direction: column; }",
    ".kt-accordion-panel .kt-row-column-wrap .kt-blocks-info-box-wrap { background: var(--global-palette9, #fff); border: 1px solid var(--global-palette7, #f0f4ec); border-radius: 12px; padding: 1.25rem 1rem 1rem; box-shadow: 0 1px 6px rgba(0,0,0,.07); display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }",
    ".kt-accordion-panel .kt-row-column-wrap .kt-blocks-info-box-link-wrap,",
    ".kt-accordion-panel .kt-row-column-wrap .kt-infobox-textcontent { display: flex; flex-direction: column; flex: 1; }",
    ".kt-accordion-panel .kt-row-column-wrap .kt-info-box-image { width: 96px !important; height: 96px !important; object-fit: cover !important; border-radius: 50%; display: block !important; margin: 0 auto .875rem; }",
    ".kt-accordion-panel .kt-row-column-wrap .kt-blocks-info-box-media,",
    ".kt-accordion-panel .kt-row-column-wrap .kadence-info-box-image-inner-intrisic-container,",
    ".kt-accordion-panel .kt-row-column-wrap .kadence-info-box-image-intrisic,",
    ".kt-accordion-panel .kt-row-column-wrap .kadence-info-box-image-inner-intrisic { display: block; width: 96px; height: 96px; margin: 0 auto; overflow: hidden; }",
    ".kt-accordion-panel .kt-row-column-wrap .kt-blocks-info-box-title { font-size: 1rem; font-weight: 700; margin: 0 0 .2rem; text-align: center; }",
    ".kt-accordion-panel .kt-row-column-wrap .kt-blocks-info-box-text { font-size: .875rem; text-align: center; margin: 0 0 .5rem; line-height: 1.4; }",
    ".kt-accordion-panel .kt-row-column-wrap .kt-blocks-info-box-text a { font-size: .75rem; word-break: break-all; color: var(--global-palette2, #446d33); }",
    "",
    "/* ── Site footer ───────────────────────────────────────────────────────────── */",
    ".site-footer { background: var(--global-palette1, #314e25); color: var(--global-palette9, #fff); padding: 2rem var(--global-content-edge-padding, 1.5rem); margin-top: 3rem; }",
    ".site-footer-inner { max-width: var(--global-content-width, 1290px); margin: 0 auto; }",
    ".site-footer-copy { margin: 0; opacity: .8; font-size: .875rem; }",
    "",
    "/* ── Mobile (≤ 1024px) ─────────────────────────────────────────────────────── */",
    "@media (max-width: 1024px) {",
    "  .kb-nav-toggle { display: block; }",
    `  .site-navigation { display: none; position: fixed; inset: ${headerMinHeight} 0 0 0; background: var(--global-palette9, #fff); overflow-y: auto; z-index: 999; padding: 1rem; margin-left: 0; }`,
    "  .site-navigation.is-open { display: block; }",
    "  .kb-nav-menu { flex-direction: column; align-items: stretch; gap: 0; }",
    "  .kb-nav-link { padding: .75rem .5rem; border-bottom: 1px solid var(--global-palette7, #eee); }",
    "  .menu-item-has-children > .sub-menu, .kb-nav-mega-menu-item > .kb-mega-menu { display: none; }",
    "  .menu-item-has-children.is-open > .sub-menu, .kb-nav-mega-menu-item.is-open > .kb-mega-menu { display: block; position: static; transform: none; min-width: unset; max-width: unset; border: none; border-radius: 0; box-shadow: none; background: var(--global-palette7, #f0f4ec); padding: .25rem 0 .25rem 1rem; }",
    "  .kb-mega-menu-cols { flex-direction: column; gap: 0; }",
    "}",
    ""
  ].join("\n");
}

async function configureProjectFromProfile(root, config, report, progress = () => {}) {
  const profile = config.siteProfile;
  if (!profile || config.dryRun) {
    if (profile) {
      report.configure = {
        ...(report.configure || {}),
        themeCssPath: path.join(root, CONFIGURE_THEME_FILE),
        separatorsDir: path.join(root, "assets", "separators"),
        summary: buildConfigureSummary(profile),
        note: "Configure artifacts will be written on non-dry-run"
      };
      progress("ok", "CONFIGURE: profiilipohjaiset asetukset valmiina (dry run)");
    }
    return;
  }

  const themePath = path.join(root, CONFIGURE_THEME_FILE);
  const separatorDir = path.join(root, "assets", "separators");
  await fs.mkdir(path.dirname(themePath), { recursive: true });
  await fs.mkdir(separatorDir, { recursive: true });
  await fs.writeFile(themePath, themeCssFromProfile(profile), "utf8");

  const writtenSeparators = [];
  for (const name of profile.separatorsUsed || []) {
    if (!SEPARATOR_SVG_TEMPLATES[name]) continue;
    const filePath = path.join(separatorDir, `${name}.svg`);
    await fs.writeFile(filePath, `${SEPARATOR_SVG_TEMPLATES[name]}\n`, "utf8");
    writtenSeparators.push(filePath);
  }

  report.configure = {
    ...(report.configure || {}),
    themeCssPath: themePath,
    separatorsDir: separatorDir,
    separatorsGenerated: writtenSeparators,
    summary: buildConfigureSummary(profile)
  };
  progress("ok", `CONFIGURE: theme.css generoitu (${Object.keys(profile.palette || {}).length} palette-arvoa)`);
  if (writtenSeparators.length) progress("ok", `CONFIGURE: separatorit generoitu (${writtenSeparators.length} kpl)`);
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function detectThemeFromSignals(homepageHtml, stylesheetUrls = []) {
  const candidates = [];
  const html = String(homepageHtml || "");

  for (const match of html.matchAll(/wp-content\/themes\/([^\/"'?#]+)/gi)) candidates.push(match[1]);
  for (const url of stylesheetUrls) {
    const match = String(url).match(/wp-content\/themes\/([^\/"'?#]+)/i);
    if (match?.[1]) candidates.push(match[1]);
  }
  const bodyTheme = html.match(/\btheme-([a-z0-9_-]+)/i)?.[1];
  if (bodyTheme) candidates.push(bodyTheme);

  const slugs = uniqueNonEmpty(candidates);
  const primarySlug = slugs[0] || "";
  const isKadence = slugs.some((slug) => slug.toLowerCase().includes("kadence")) || /\bkb-(?:row|section|tabs|accordion|navigation)\b/i.test(html);

  return {
    slug: primarySlug,
    candidates: slugs,
    kadence: isKadence,
    proSignals: /kadence[-_\s]?pro|kb-(?:navigation|modal|toc|countdown|off-canvas|lottie)/i.test(html)
  };
}

function detectPluginsFromSignals(homepageHtml, restRoot, stylesheetUrls = []) {
  const html = String(homepageHtml || "");
  const namespaces = Array.isArray(restRoot?.namespaces) ? restRoot.namespaces.map((value) => String(value || "").toLowerCase()) : [];
  const haystack = [html, ...stylesheetUrls, namespaces.join(" ")].join("\n").toLowerCase();
  const matches = [];
  const push = (slug, name, signal) => {
    if (matches.some((item) => item.slug === slug)) return;
    matches.push({ slug, name, signal });
  };

  if (haystack.includes("wpml") || haystack.includes("wpml-ls")) push("wpml", "WPML", "HTML / REST namespace");
  if (haystack.includes("gtranslate")) push("gtranslate", "GTranslate", "HTML shortcode / asset");
  if (haystack.includes("aioseo")) push("aioseo", "All in One SEO", "REST namespace / asset");
  if (haystack.includes("complianz")) push("complianz", "Complianz", "Asset or cookie markup");
  if (haystack.includes("newsletter")) push("newsletter", "Newsletter", "Asset or form markup");
  if (haystack.includes("betterdocs")) push("betterdocs", "BetterDocs", "Asset or REST namespace");
  if (haystack.includes("embedpress")) push("embedpress", "EmbedPress", "Asset or markup");
  if (haystack.includes("independent analytics") || haystack.includes("iawp")) push("iawp", "Independent Analytics", "Asset or REST namespace");
  if (haystack.includes("kadence")) push("kadence-blocks", "Kadence / Kadence Blocks", "Theme, HTML classes, or asset path");
  if (haystack.includes("kadence pro") || /\bkb-(?:navigation|modal|toc|countdown|off-canvas|lottie)\b/i.test(html)) push("kadence-pro", "Kadence Pro", "Pro block classes or assets");
  if (haystack.includes("woocommerce")) push("woocommerce", "WooCommerce", "REST namespace / asset");
  if (haystack.includes("mailerlite")) push("mailerlite", "MailerLite integration", "Asset or form integration");
  if (haystack.includes("mailchimp")) push("mailchimp", "Mailchimp integration", "Asset or form integration");

  return matches;
}

async function analyzeSite(config, progress = () => {}) {
  const headers = buildAuthHeaders(config, progress);
  const warnings = [];
  const report = {
    startedAt: new Date().toISOString(),
    wpBaseUrl: config.wpBaseUrl,
    warnings,
    workflow: ["discover", "configure", "migrate"]
  };

  progress("info", `DISCOVER: analysoidaan sivusto → ${config.wpBaseUrl}`);
  progress("info", "DISCOVER: haetaan etusivun HTML ja tunnisteet…");
  const homepageHtml = await fetchText(ensureTrailingSlash(config.wpBaseUrl), headers);
  const stylesheetUrls = extractStylesheetUrls(homepageHtml, config.wpBaseUrl);
  const inlineStyles = extractInlineStyles(homepageHtml);
  const navs = extractNavFromHtml(homepageHtml, config.wpBaseUrl);
  const cssVariableMap = {};
  for (const inlineStyle of inlineStyles) Object.assign(cssVariableMap, extractCssVariables(inlineStyle));

  progress("ok", `DISCOVER: etusivu haettu (${stylesheetUrls.length} stylesheetiä, ${navs.length} navigaatiota)`);

  let restRoot = null;
  try {
    progress("info", "DISCOVER: tarkistetaan WordPress REST -juuri…");
    restRoot = await fetchJson(joinUrl(config.wpBaseUrl, "/wp-json/"), headers);
    progress("ok", `DISCOVER: REST juuri löytyi (${(restRoot?.namespaces || []).length} namespacea)`);
  } catch (err) {
    warnings.push(`REST root failed: ${String(err.message || err)}`);
    progress("warn", "DISCOVER: REST-juurta ei saatu luettua");
  }

  const theme = detectThemeFromSignals(homepageHtml, stylesheetUrls);
  const plugins = detectPluginsFromSignals(homepageHtml, restRoot, stylesheetUrls);
  const htmlLang = homepageHtml.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] || "";
  const languages = uniqueNonEmpty([
    htmlLang,
    /\/en\//i.test(homepageHtml) ? "en" : "",
    /wpml|gtranslate/i.test(homepageHtml) ? "multilingual-signal" : ""
  ]);

  const contentCounts = {};
  const detectedNamespaces = Array.isArray(restRoot?.namespaces)
    ? restRoot.namespaces.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const recommendedNamespace = detectedNamespaces.find((ns) => ns === "wp/v2")
    ? "/wp-json/wp/v2"
    : detectedNamespaces.find((ns) => /\/v\d+$/i.test(ns))
      ? `/wp-json/${detectedNamespaces.find((ns) => /\/v\d+$/i.test(ns))}`
      : (config.restNamespace || DEFAULT_NAMESPACE);
  const baseApi = joinUrl(config.wpBaseUrl, recommendedNamespace);
  for (const type of DEFAULT_TYPES) {
    try {
      progress("info", `DISCOVER: lasketaan ${type} REST API:n kautta…`);
      const items = await fetchAllPages(`${baseApi}/${type}`, headers);
      contentCounts[type] = items.length;
      progress("ok", `DISCOVER: ${type} ${items.length} kohdetta`);
    } catch (err) {
      warnings.push(`Count fetch for ${type} failed: ${String(err.message || err)}`);
      progress("warn", `DISCOVER: ${type}-määrää ei saatu laskettua`);
    }
  }

  const menus = await fetchMenus(config.wpBaseUrl, headers, warnings);
  if (menus.menus.length) progress("ok", `DISCOVER: valikot löydetty REST API:sta (${menus.menus.length} kpl)`);
  else progress("warn", "DISCOVER: valikot eivät olleet saatavilla REST API:sta");

  for (const stylesheetUrl of stylesheetUrls.slice(0, 8)) {
    try {
      const css = await fetchText(stylesheetUrl, headers);
      Object.assign(cssVariableMap, extractCssVariables(css));
    } catch (err) {
      warnings.push(`Stylesheet scan failed for ${stylesheetUrl}: ${String(err.message || err)}`);
    }
  }

  const recommendedPreset = theme.proSignals
    ? "kadence-pro"
    : theme.kadence || plugins.some((plugin) => plugin.slug === "kadence-blocks")
      ? "kadence"
      : "none";
  const discoveredContentProfile = await discoverContentProfile(baseApi, headers, progress, warnings);
  const palette = extractPaletteFromVariables(cssVariableMap);

  let headerStyles = null;
  if (recommendedPreset === "kadence-pro" || recommendedPreset === "kadence") {
    try {
      progress("info", "DISCOVER: haetaan Kadence header -tyyliasetukset…");
      const kadenceHeaders = await fetchKadenceHeaders({ wpBaseUrl: config.wpBaseUrl, restNamespace: recommendedNamespace, authMode: config.authMode, wpUser: config.wpUser, wpAppPassword: config.wpAppPassword, wpBearerToken: config.wpBearerToken }, headers);
      if (kadenceHeaders.length) {
        headerStyles = kadenceHeaders[0].styles;
        progress("ok", `DISCOVER: header-tyylit löydetty (korkeus: ${headerStyles.minHeight ?? "oletus"}, tausta: ${headerStyles.backgroundType ?? "oletus"})`);
      }
    } catch (err) {
      warnings.push(`Header style fetch failed: ${String(err.message || err)}`);
    }
  }

  const siteProfile = {
    generatedAt: new Date().toISOString(),
    wpBaseUrl: config.wpBaseUrl,
    restNamespace: recommendedNamespace,
    preset: recommendedPreset,
    palette,
    headerStyles,
    separatorsUsed: discoveredContentProfile.separatorsUsed,
    colLayouts: discoveredContentProfile.colLayouts,
    blocksUsed: discoveredContentProfile.blocksUsed,
    heroPages: discoveredContentProfile.heroPages,
    headingColors: discoveredContentProfile.headingColors,
    headingSizes: discoveredContentProfile.headingSizes,
    buttonStyles: discoveredContentProfile.buttonStyles,
    inlineStylesSource: inlineStyles.length ? "homepage-inline-style" : "",
    scannedTypes: discoveredContentProfile.scannedTypes
  };
  const configureSummary = buildConfigureSummary(siteProfile);

  report.analysis = {
    structure: {
      htmlLang,
      languages,
      navigationCount: navs.length,
      primaryNavigationItems: navs[0]?.items?.length || 0,
      headingCount: (homepageHtml.match(/<h[1-6]\b/gi) || []).length,
      formCount: (homepageHtml.match(/<form\b/gi) || []).length,
      contentCounts
    },
    styles: {
      stylesheetCount: stylesheetUrls.length,
      sameOriginStylesheets: stylesheetUrls.filter((url) => {
        try { return new URL(url).origin === new URL(config.wpBaseUrl).origin; } catch { return false; }
      }).length,
      inlineStyleBlocks: inlineStyles.length
    },
    theme,
    rest: {
      available: Boolean(restRoot),
      namespaceCount: Array.isArray(restRoot?.namespaces) ? restRoot.namespaces.length : 0,
      namespaces: detectedNamespaces,
      recommendedNamespace
    },
    menus: {
      source: menus.source || "unavailable",
      detected: menus.menus.length
    },
    plugins,
    recommendations: [
      recommendedPreset === "kadence-pro"
        ? "Sivusto näyttää käyttävän Kadence Prota. Käytä Kadence Pro -presetiä ja pidä lohko- sekä tyylimigraatio päällä."
        : recommendedPreset === "kadence"
          ? "Sivusto näyttää käyttävän Kadencea. Kadence-preset on todennäköisesti järkevin lähtökohta."
          : "Sivusto ei näytä puhtaalta Kadence-tapaukselta. Aloita neutraalilla presetillä ja lisää muunnokset tarpeen mukaan.",
      languages.length > 1 || plugins.some((plugin) => plugin.slug === "wpml")
        ? "Monikielisyydestä on signaaleja. Varmista kielikohtaiset permalinkit, valikot ja sisältökokoelmat ennen julkaisua."
        : "Monikielisyydestä ei näy vahvaa signaalia etusivun perusteella.",
      menus.menus.length
        ? "Valikkorakennetta näyttää olevan saatavilla. Tarkista silti HTML-fallbackin tai REST-valikkojen laatu migraation jälkeen."
        : "Valikkojen automaattinen tuonti voi vaatia fallback-parsintaa tai manuaalista täydentämistä."
    ],
    configure: configureSummary
  };
  report.siteProfile = siteProfile;
  report.configure = configureSummary;

  report.finishedAt = new Date().toISOString();
  progress("ok", "DISCOVER: sivustoprofiili valmis");
  return report;
}

function normalizeEleventyReplacements(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => ({
    slug: String(item?.slug || "").trim(),
    wordpressPlugin: String(item?.wordpressPlugin || "").trim(),
    eleventySolution: String(item?.eleventySolution || "").trim(),
    packageName: String(item?.packageName || "").trim(),
    enabled: Boolean(item?.enabled ?? true)
  })).filter((item) => item.slug && item.wordpressPlugin && item.eleventySolution);
}

async function writeEleventyPluginPlan(root, config, report, progress = () => {}) {
  const replacements = normalizeEleventyReplacements(config.eleventyReplacements);
  if (!replacements.length) {
    report.eleventyPlugins = { selected: 0, enabled: 0 };
    return;
  }

  const enabled = replacements.filter((item) => item.enabled);
  const planPath = path.join(root, "eleventy-plugin-plan.json");
  const snippetPath = path.join(root, "eleventy-plugin-plan.mjs");
  report.eleventyPlugins = {
    selected: replacements.length,
    enabled: enabled.length,
    planPath,
    snippetPath
  };

  if (config.dryRun) {
    progress("ok", `Eleventy-pluginisuunnitelma: ${enabled.length}/${replacements.length} valittuna (dry run)`);
    return;
  }

  await fs.writeFile(planPath, `${JSON.stringify(replacements, null, 2)}\n`, "utf8");
  const snippet = [
    "// Auto-generated by wp-eleventy-migrator",
    "// Review package names and wire them into your real Eleventy config as needed.",
    "export const eleventyPluginPlan = [",
    ...enabled.map((item) => `  { slug: ${JSON.stringify(item.slug)}, wordpressPlugin: ${JSON.stringify(item.wordpressPlugin)}, eleventySolution: ${JSON.stringify(item.eleventySolution)}, packageName: ${JSON.stringify(item.packageName)} },`),
    "];",
    ""
  ].join("\n");
  await fs.writeFile(snippetPath, snippet, "utf8");
  progress("ok", `Eleventy-pluginisuunnitelma kirjoitettu: ${enabled.length}/${replacements.length} käytössä`);
}

function deriveProjectName(config) {
  const fromUrl = slugify(String(config.wpBaseUrl || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]);
  return fromUrl || "eleventy-site";
}

function getEnabledReplacementSlugs(config) {
  return new Set(
    normalizeEleventyReplacements(config.eleventyReplacements)
      .filter((item) => item.enabled)
      .map((item) => item.slug)
  );
}

function inferBootstrapDependencies(config) {
  const dependencies = {
    "@11ty/eleventy": "^3.0.0"
  };
  const replacements = normalizeEleventyReplacements(config.eleventyReplacements).filter((item) => item.enabled);
  for (const item of replacements) {
    if (item.packageName === "@11ty/eleventy-navigation") {
      dependencies["@11ty/eleventy-navigation"] = "^1.0.4";
    }
  }
  return dependencies;
}

async function writeIfMissing(filePath, content) {
  if (await fileExists(filePath)) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return true;
}

async function writeReplacementScaffolding(root, config, report, progress = () => {}) {
  const enabled = getEnabledReplacementSlugs(config);
  if (!enabled.size) {
    report.replacementScaffolding = { created: [], enabled: [] };
    return;
  }

  const includesDir = path.join(root, "_includes", "partials");
  const dataDir = path.join(root, config.dataDir || DEFAULT_DATA_DIR);
  const created = [];
  const siteJsonPath = path.join(dataDir, "site.json");
  const siteJson = {
    name: deriveProjectName(config),
    url: config.wpBaseUrl || "",
    locales: enabled.has("wpml") || enabled.has("gtranslate") ? ["fi", "en"] : ["fi"],
    defaultLocale: "fi",
    logo: "",
    tagline: ""
  };

  if (await writeIfMissing(siteJsonPath, `${JSON.stringify(siteJson, null, 2)}\n`)) created.push(siteJsonPath);

  const partials = [];

  const hs = config.siteProfile?.headerStyles || {};
  const logoIsLink = hs.logoIsLink !== false;
  const logoShowTitle = hs.logoShowTitle !== false;
  const logoWidth = hs.logoWidth ? String(hs.logoWidth) : "120";
  const logoOpenTag = logoIsLink ? `<a class="site-logo" href="/">` : `<span class="site-logo">`;
  const logoCloseTag = logoIsLink ? `</a>` : `</span>`;
  const logoAltFallback = logoShowTitle ? `{{ site.name if site and site.name else 'Site' }}` : `""`;
  const logoTitleFallback = logoShowTitle
    ? `<span class="site-name">{{ site.name if site and site.name else 'Site' }}</span>`
    : ``;

  // ── site-header.njk ──────────────────────────────────────────────────────────
  partials.push([
    path.join(includesDir, "site-header.njk"),
    `{# Site header — logo + primary navigation #}
{% set menus = navigation if navigation else [] %}
{% set navItems = menus[0].items if menus and menus.length and menus[0].items else [] %}
<header class="site-shell-header{% if transparentHeader %} is-transparent{% endif %}">
  <div class="site-header-inner">
    ${logoOpenTag}
      {% if site and site.logo %}
        <img src="{{ site.logo }}" alt="${logoAltFallback}" width="${logoWidth}">
      {% else %}
        ${logoTitleFallback}
      {% endif %}
    ${logoCloseTag}
    <button class="kb-nav-toggle" aria-expanded="false" aria-controls="site-nav-menu" aria-label="Toggle navigation">
      <span aria-hidden="true">&#9776;</span>
    </button>
    {% if navItems and navItems.length %}
    <nav id="site-nav-menu" class="site-navigation kb-navigation" aria-label="Site navigation">
      <ul class="menu kb-nav-menu">
        {% for item in navItems %}
          <li class="menu-item kb-nav-item{% if item.megamenu %} kb-nav-mega-menu-item{% elif item.children and item.children.length %} menu-item-has-children{% endif %}">
            <a class="kb-nav-link" href="{{ item.url }}"{% if item.target %} target="{{ item.target }}"{% endif %}>{{ item.title }}</a>
            {# ── Megamenu ─────────────────────────────────────────── #}
            {% if item.megamenu and item.megamenuColumns and item.megamenuColumns.length %}
              <div class="kb-mega-menu" role="region" aria-label="{{ item.title }} megamenu">
                <ul class="kb-mega-menu-cols">
                  {% for col in item.megamenuColumns %}
                    <li class="kb-mega-menu-col">
                      {% if col.items and col.items.length %}
                        <ul class="kb-mega-col-items">
                          {% for sub in col.items %}
                            <li class="menu-item">
                              <a class="kb-mega-link" href="{{ sub.url }}"{% if sub.target %} target="{{ sub.target }}"{% endif %}>{{ sub.label }}</a>
                            </li>
                          {% endfor %}
                        </ul>
                      {% endif %}
                    </li>
                  {% endfor %}
                </ul>
              </div>
            {# ── Normal dropdown ──────────────────────────────────── #}
            {% elif item.children and item.children.length %}
              <ul class="sub-menu kb-nav-sub-menu">
                {% for child in item.children %}
                  <li class="menu-item kb-nav-item{% if child.children and child.children.length %} menu-item-has-children{% endif %}">
                    <a class="kb-nav-link" href="{{ child.url }}">{{ child.title }}</a>
                    {% if child.children and child.children.length %}
                      <ul class="sub-menu kb-nav-sub-menu kb-nav-sub-menu--level2">
                        {% for grandchild in child.children %}
                          <li class="menu-item"><a class="kb-nav-link" href="{{ grandchild.url }}">{{ grandchild.title }}</a></li>
                        {% endfor %}
                      </ul>
                    {% endif %}
                  </li>
                {% endfor %}
              </ul>
            {% endif %}
          </li>
        {% endfor %}
      </ul>
    </nav>
    {% endif %}
  </div>
</header>
<script>
  document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector(".site-shell-header");

    // Transparent header: toggle is-stuck / is-transparent on scroll
    if (header && header.classList.contains("is-transparent")) {
      const onScroll = () => {
        header.classList.toggle("is-stuck", window.scrollY > 10);
        header.classList.toggle("is-transparent", window.scrollY <= 10);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    // Mobile nav toggle
    const toggle = document.querySelector(".kb-nav-toggle");
    const menu = document.getElementById("site-nav-menu");
    if (toggle && menu) {
      toggle.addEventListener("click", () => {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        menu.classList.toggle("is-open", !expanded);
      });
    }

    // Dropdown/megamenu toggle on mobile
    document.querySelectorAll(".kb-nav-mega-menu-item > .kb-nav-link, .menu-item-has-children > .kb-nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        if (window.innerWidth <= 1024) { e.preventDefault(); link.parentElement.classList.toggle("is-open"); }
      });
    });
  });
</script>
`
  ]);

  // ── site-footer.njk ──────────────────────────────────────────────────────────
  partials.push([
    path.join(includesDir, "site-footer.njk"),
    `{# Site footer — update with actual footer content #}
<footer class="site-footer">
  <div class="site-footer-inner">
    <p class="site-footer-copy">
      &copy; {{ site.name if site and site.name else 'Site' }}
    </p>
  </div>
</footer>
`
  ]);

  // ── site-navigation.njk — legacy alias used by existing templates ─────────────
  partials.push([
    path.join(includesDir, "site-navigation.njk"),
    `{#- Legacy alias: renders the same primary nav as site-header.njk uses.
    Kept for backward compatibility with any content referencing this partial. #}
{% set menus = navigation if navigation else [] %}
{% set navItems = menus[0].items if menus and menus.length and menus[0].items else [] %}
{% if navItems and navItems.length %}
<nav class="site-navigation kb-navigation" aria-label="Site navigation">
  <ul class="menu kb-nav-menu">
    {% for item in navItems %}
      <li class="menu-item kb-nav-item{% if item.megamenu %} kb-nav-mega-menu-item{% elif item.children and item.children.length %} menu-item-has-children{% endif %}">
        <a class="kb-nav-link" href="{{ item.url }}"{% if item.target %} target="{{ item.target }}"{% endif %}>{{ item.title }}</a>
        {% if item.megamenu and item.megamenuColumns and item.megamenuColumns.length %}
          <div class="kb-mega-menu" role="region" aria-label="{{ item.title }} megamenu">
            <ul class="kb-mega-menu-cols">
              {% for col in item.megamenuColumns %}
                <li class="kb-mega-menu-col">
                  {% if col.items and col.items.length %}
                    <ul class="kb-mega-col-items">
                      {% for sub in col.items %}
                        <li class="menu-item"><a class="kb-mega-link" href="{{ sub.url }}">{{ sub.label }}</a></li>
                      {% endfor %}
                    </ul>
                  {% endif %}
                </li>
              {% endfor %}
            </ul>
          </div>
        {% elif item.children and item.children.length %}
          <ul class="sub-menu kb-nav-sub-menu">
            {% for child in item.children %}
              <li class="menu-item kb-nav-item"><a class="kb-nav-link" href="{{ child.url }}">{{ child.title }}</a></li>
            {% endfor %}
          </ul>
        {% endif %}
      </li>
    {% endfor %}
  </ul>
</nav>
{% endif %}
`
  ]);

  if (enabled.has("wpml") || enabled.has("gtranslate")) {
    partials.push([
      path.join(includesDir, "language-switcher.njk"),
      `{# Generated multilingual switcher. Edit _data/site.json locales as needed. #}
{% if site and site.locales and site.locales.length > 1 %}
<nav class="language-switcher" aria-label="Language switcher">
  <ul>
    {% for locale in site.locales %}
      <li><a href="/{{ locale }}/">{{ locale | upper }}</a></li>
    {% endfor %}
  </ul>
</nav>
{% endif %}
`
    ]);
  }

  if (enabled.has("newsletter") || enabled.has("mailerlite") || enabled.has("mailchimp")) {
    partials.push([
      path.join(includesDir, "newsletter-signup.njk"),
      `{# Generated newsletter placeholder. Replace with your service embed form. #}
<section class="newsletter-signup">
  <h2>Newsletter</h2>
  <p>Replace this placeholder with your MailerLite/Mailchimp/Brevo embed form.</p>
</section>
`
    ]);
  }

  if (enabled.has("complianz")) {
    partials.push([
      path.join(includesDir, "cookie-consent-placeholder.njk"),
      `{# Generated cookie consent placeholder. Replace with your preferred consent tool if tracking is used. #}
<div class="cookie-consent-placeholder" hidden data-cookie-consent-placeholder="true"></div>
`
    ]);
  }

  for (const [filePath, content] of partials) {
    if (await writeIfMissing(filePath, content)) created.push(filePath);
  }

  report.replacementScaffolding = {
    enabled: [...enabled],
    created
  };
  progress("ok", `Eleventy-vastineiden scaffoldit: ${created.length} tiedostoa`);
}

function slugifyCollectionName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function bootstrapEleventyProject(root, config, report, progress = () => {}, categoryNames = []) {
  if (config.siteMode === "existing") {
    report.bootstrap = { skipped: true, reason: "existing-site-mode" };
    progress("info", "Eleventy-bootstrap ohitettu: päivitetään olemassa olevaa projektia");
    return;
  }

  const dependencies = inferBootstrapDependencies(config);
  const usesNavigation = Object.prototype.hasOwnProperty.call(dependencies, "@11ty/eleventy-navigation");
  const packageJsonPath = path.join(root, "package.json");
  const configJsPath = path.join(root, "eleventy.config.js");
  const legacyConfigJsPath = path.join(root, ".eleventy.js");
  const gitignorePath = path.join(root, ".gitignore");
  const notesPath = path.join(root, "MIGRATION-NOTES.md");

  const packageJson = {
    name: deriveProjectName(config),
    private: true,
    scripts: {
      dev: "eleventy --serve",
      build: "eleventy"
    },
    dependencies
  };

  const configLines = [];
  if (usesNavigation) {
    configLines.push('const eleventyNavigationPlugin = require("@11ty/eleventy-navigation");');
    configLines.push("");
  }
  configLines.push('const { existsSync } = require("node:fs");');
  configLines.push("");
  configLines.push("module.exports = function(eleventyConfig) {");
  if (usesNavigation) {
    configLines.push("  eleventyConfig.addPlugin(eleventyNavigationPlugin);");
  }
  configLines.push('  if (existsSync("media")) eleventyConfig.addPassthroughCopy({ "media": "media" });');
  configLines.push('  if (existsSync("styles")) eleventyConfig.addPassthroughCopy({ "styles": "styles" });');
  configLines.push('  if (existsSync("assets")) eleventyConfig.addPassthroughCopy({ "assets": "assets" });');
  configLines.push("");

  // Generate collections from WP categories
  configLines.push("  const byDate = (a, b) => b.date - a.date;");
  configLines.push("");
  configLines.push('  eleventyConfig.addCollection("posts", col =>');
  configLines.push('    col.getAll().filter(p => p.data.sourceType === "posts").sort(byDate)');
  configLines.push("  );");
  const seenSlugs = new Set(["posts"]);
  for (const catName of categoryNames) {
    const slug = slugifyCollectionName(catName);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    configLines.push(`  eleventyConfig.addCollection(${JSON.stringify(slug)}, col =>`);
    configLines.push(`    col.getAll().filter(p => p.data.sourceType === "posts" && (p.data.categories || []).includes(${JSON.stringify(catName)})).sort(byDate)`);
    configLines.push("  );");
  }
  configLines.push("");

  configLines.push("  return {");
  configLines.push('    dir: { input: "content", includes: "../_includes", data: "../_data", output: "_site" },');
  configLines.push('    templateFormats: ["md", "njk", "html"],');
  configLines.push('    markdownTemplateEngine: "njk",');
  configLines.push('    htmlTemplateEngine: "njk",');
  configLines.push('    dataTemplateEngine: "njk"');
  configLines.push("  };");
  configLines.push("};");
  configLines.push("");

  const notes = [
    "# Migration Notes",
    "",
    "This project was bootstrapped by `wp-eleventy-migrator`.",
    "",
    "## Next steps",
    "",
    "1. Run `npm install` in this folder to install Eleventy and any selected plugins.",
    "2. Run `npm run dev` to preview the migrated site locally.",
    "3. Review `_includes/`, `_data/`, styles, and content output before publishing.",
    ""
  ].join("\n");

  const bootstrap = {
    packageJsonPath,
    configJsPath,
    legacyConfigJsPath,
    gitignorePath,
    notesPath,
    dependencies: Object.keys(dependencies),
    created: []
  };

  if (config.dryRun) {
    report.bootstrap = { ...bootstrap, note: "Bootstrap files will be created on non-dry-run" };
    progress("ok", `Eleventy-bootstrap suunniteltu: ${bootstrap.dependencies.join(", ")}`);
    return;
  }

  if (await writeIfMissing(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)) bootstrap.created.push(packageJsonPath);
  if (await writeIfMissing(configJsPath, configLines.join("\n"))) bootstrap.created.push(configJsPath);
  if (await writeIfMissing(legacyConfigJsPath, 'module.exports = require("./eleventy.config.js");\n')) bootstrap.created.push(legacyConfigJsPath);
  if (await writeIfMissing(gitignorePath, "_site/\nnode_modules/\n.DS_Store\n")) bootstrap.created.push(gitignorePath);
  if (await writeIfMissing(notesPath, notes)) bootstrap.created.push(notesPath);

  report.bootstrap = bootstrap;
  progress("ok", `Eleventy-bootstrap valmis: ${bootstrap.created.length} tiedostoa`);
}

async function installProjectDependencies(root, config, report, progress = () => {}) {
  const packageJsonPath = path.join(root, "package.json");
  const shouldInstall = config.siteMode === "new";
  if (!shouldInstall) {
    report.install = { skipped: true, reason: "existing-site-mode" };
    progress("info", "Riippuvuuksien asennus ohitettu: päivitetään olemassa olevaa projektia");
    return;
  }

  if (!(await fileExists(packageJsonPath))) {
    report.install = { skipped: true, reason: "missing-package-json" };
    progress("warn", "Riippuvuuksia ei voitu asentaa: package.json puuttuu");
    return;
  }

  if (config.dryRun) {
    report.install = { planned: true, command: "npm install" };
    progress("ok", "Riippuvuuksien asennus suunniteltu: npm install (dry run)");
    return;
  }

  try {
    progress("info", "Asennetaan Eleventy-riippuvuudet…");
    await new Promise((resolve, reject) => {
      const child = spawn("npm", ["install", "--no-fund", "--no-audit"], {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";
      let lastOutputAt = Date.now();
      const captured = [];
      const heartbeat = setInterval(() => {
        if (Date.now() - lastOutputAt > 8000) {
          progress("info", "npm install yhä käynnissä… odotetaan paketinhallinnan vastausta");
          lastOutputAt = Date.now();
        }
      }, 4000);

      const emitLines = (chunk, level, bufferRef) => {
        lastOutputAt = Date.now();
        bufferRef.value += chunk;
        const parts = bufferRef.value.split(/\r?\n/);
        bufferRef.value = parts.pop() || "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          captured.push(trimmed);
          progress(level, `npm: ${trimmed}`);
        }
      };

      child.stdout.on("data", (chunk) => emitLines(String(chunk), "info", { get value() { return stdoutBuffer; }, set value(v) { stdoutBuffer = v; } }));
      child.stderr.on("data", (chunk) => emitLines(String(chunk), "warn", { get value() { return stderrBuffer; }, set value(v) { stderrBuffer = v; } }));

      child.on("error", (error) => {
        clearInterval(heartbeat);
        reject(error);
      });

      child.on("close", (code) => {
        clearInterval(heartbeat);
        const flush = (rest, level) => {
          const trimmed = String(rest || "").trim();
          if (!trimmed) return;
          captured.push(trimmed);
          progress(level, `npm: ${trimmed}`);
        };
        flush(stdoutBuffer, "info");
        flush(stderrBuffer, "warn");
        if (code === 0) {
          resolve(captured);
          return;
        }
        const error = new Error(`npm install exited with code ${code}`);
        error.detail = captured.slice(-20).join("\n");
        reject(error);
      });
    });
    report.install = { ran: true, command: "npm install" };
    progress("ok", "Riippuvuudet asennettu: npm install");
  } catch (err) {
    const detail = String(err?.detail || err?.stderr || err?.stdout || err?.message || err);
    report.install = { ran: true, failed: true, command: "npm install", detail };
    report.warnings.push(`npm install failed: ${detail}`);
    progress("warn", "Riippuvuuksien asennus epäonnistui, tarkista loki");
  }
}

async function verifyProjectOutput(root, config, report, progress = () => {}) {
  const requiredForNew = [
    path.join(root, "package.json"),
    path.join(root, "eleventy.config.js")
  ];
  const missing = [];
  for (const filePath of requiredForNew) {
    if (!(await fileExists(filePath))) missing.push(filePath);
  }

  report.outputVerification = {
    siteMode: config.siteMode,
    missing
  };

  if (config.siteMode === "new") {
    if (!missing.length) {
      report.outputVerification.ok = true;
      progress("ok", "Output-verifiointi: Eleventy-projektin perusrunko löytyi");
      return;
    }
    report.outputVerification.ok = false;
    for (const filePath of missing) {
      progress("warn", `Output-verifiointi: puuttuu ${path.basename(filePath)}`);
    }
    throw new Error(`Migraation output on vajaa: ${missing.map((filePath) => path.basename(filePath)).join(", ")} puuttuu kohdeprojektista`);
  }

  if (missing.length) {
    report.outputVerification.ok = false;
    progress("warn", "Olemassa olevan projektin juuresta puuttuu package.json tai eleventy.config.js. Jos tämä ei ollut tarkoitus, käytä tilaa 'Luo uusi sivusto'.");
    return;
  }

  report.outputVerification.ok = true;
  progress("ok", "Output-verifiointi: olemassa olevan projektin Eleventy-runko löytyi");
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

const NAMESPACE_TO_PLUGIN = {
  "kadence-pro/v1":        { name: "Kadence Pro",           slug: "kadence-pro",              effort: "medium" },
  "kadence-blocks/v1":     { name: "Kadence Blocks",         slug: "kadence-blocks",           effort: "low" },
  "kadence/v1":            { name: "Kadence Theme",          slug: "kadence",                  effort: "low" },
  "wc/v3":                 { name: "WooCommerce",            slug: "woocommerce",              effort: "high" },
  "wpcf7/v1":              { name: "Contact Form 7",         slug: "contact-form-7",           effort: "medium" },
  "yoast/v1":              { name: "Yoast SEO",              slug: "wordpress-seo",            effort: "low" },
  "yoast/v1/analyze":      { name: "Yoast SEO",              slug: "wordpress-seo",            effort: "low" },
  "rankmath/v1":           { name: "Rank Math SEO",          slug: "seo-by-rank-math",         effort: "low" },
  "elementor/v1":          { name: "Elementor",              slug: "elementor",                effort: "high" },
  "wp-block-editor/v1":    null,
  "acf/v3":                { name: "Advanced Custom Fields", slug: "advanced-custom-fields",   effort: "medium" },
  "pods/v1":               { name: "Pods",                   slug: "pods",                     effort: "medium" },
  "wpml/v1":               { name: "WPML (Multilingual)",   slug: "sitepress-multilingual-cms",effort: "high" },
  "polylang/v2":           { name: "Polylang",               slug: "polylang",                 effort: "high" },
  "wp-job-manager/v1":     { name: "WP Job Manager",         slug: "wp-job-manager",           effort: "high" },
  "gravityforms/v2":       { name: "Gravity Forms",          slug: "gravityforms",             effort: "medium" },
  "ninja-forms/v3":        { name: "Ninja Forms",            slug: "ninja-forms",              effort: "medium" },
  "mc4wp/v1":              { name: "Mailchimp for WP",       slug: "mailchimp-for-wp",         effort: "medium" },
  "bbp/v1":                { name: "bbPress",                slug: "bbpress",                  effort: "high" },
  "buddypress/v1":         { name: "BuddyPress",             slug: "buddypress",               effort: "high" },
  "loftocean/v1":          { name: "Loftocean (custom)",     slug: "loftocean",                effort: "high" },
  "betterdocs/v1":         { name: "BetterDocs",             slug: "betterdocs",               effort: "high" },
};

const PLUGIN_REPLACEMENTS = {
  "kadence-pro":            "Kadence-lohkot muutetaan Nunjucks-partiaaleiksi (preset: kadence-pro).",
  "kadence-blocks":         "Kadence-lohkot muutetaan Nunjucks-partiaaleiksi (preset: kadence).",
  "kadence":                "Kadence-teema → Eleventy-pohja. Tyylit migratoidaan best-effort-mallilla.",
  "woocommerce":            "WooCommerce → erillinen staattinen catalog (esim. Snipcart/Stripe Checkout) tai erillinen backend.",
  "contact-form-7":         "CF7-lomakkeet → staattinen HTML-lomake + Netlify Forms / Formspree / Web3Forms.",
  "wordpress-seo":          "Yoast SEO → Eleventy SEO -plugin tai meta-tiedot front matterissa.",
  "seo-by-rank-math":       "Rank Math SEO → Eleventy SEO -plugin tai meta-tiedot front matterissa.",
  "elementor":              "Elementor-rakenteet täytyy rakentaa uudelleen Eleventy-pohjina (korkea työmäärä).",
  "advanced-custom-fields": "ACF-kentät tallennetaan front matteriin migraation aikana jos ne löytyvät REST API:sta.",
  "pods":                   "Pods custom types → Eleventy data files + custom collections.",
  "sitepress-multilingual-cms": "WPML → Eleventy i18n (korkea työmäärä, vaatii erikseen suunnittelun).",
  "polylang":               "Polylang → Eleventy i18n (korkea työmäärä).",
  "wp-job-manager":         "WP Job Manager → staattinen JSON data + Eleventy template.",
  "gravityforms":           "Gravity Forms → Formspree / Netlify Forms / Web3Forms.",
  "ninja-forms":            "Ninja Forms → Formspree / Netlify Forms / Web3Forms.",
  "mailchimp-for-wp":       "Mailchimp subscribe-widget → uppotettu Mailchimp-lomake tai API-kutsu.",
  "bbpress":                "bbPress-keskustelut eivät sovi staattiselle sivustolle — harkitse Discourse/Disqus.",
  "buddypress":             "BuddyPress-yhteisöominaisuudet eivät sovi staattiselle sivustolle.",
  "betterdocs":             "BetterDocs-dokumentaatio → erillinen Eleventy-collection tai erillinen dokumentaatiosivusto.",
  "loftocean":              "Loftocean-custom → analysoi rakenne erikseen, luo vastaava Eleventy-komponentti.",
};

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
      if (subTitle) children.push({ title: subTitle, url: localizeSiteUrl(subHref, baseUrl) });
      }

      // Extract megamenu columns (divs with mega-column classes)
      const megaColumns = [];
      if (isMega) {
        for (const colMatch of liBody.matchAll(/<(?:div|ul)[^>]+class=["'][^"']*(?:mega-?col|kb-nav-mega)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|ul)>/gi)) {
          const colItems = [];
          for (const colA of colMatch[1].matchAll(/<a([^>]*)>([^<]*)<\/a>/gi)) {
            const colHref  = colA[1].match(/href=["']([^"']+)["']/i)?.[1] ?? "";
            const colTitle = colA[2].trim();
            if (colTitle) colItems.push({ title: colTitle, url: localizeSiteUrl(colHref, baseUrl) });
          }
          if (colItems.length) megaColumns.push({ items: colItems });
        }
      }

      if (title) items.push({ title, url: localizeSiteUrl(url, baseUrl), classes: liClasses, megamenu: isMega, megamenuColumns: megaColumns, children });
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

    // Download CSS-referenced assets. Font files (woff/woff2/ttf/otf/eot) are always downloaded when
    // migrateStyles is on because rewriteCssUrls already rewrites their paths to /media/... — without
    // the actual files the CSS would reference broken local URLs. Other media (images) require downloadMedia.
    const FONT_EXT = /\.(woff2?|ttf|otf|eot)(\?[^"')]*)?$/i;
    if (isSameOrigin && !config.dryRun) {
      for (const mediaUrl of extractCssMediaUrls(rawCss, cssUrl)) {
        try {
          if (!mediaUrl.startsWith(wpOrigin)) continue;
          const mUrlObj = new URL(mediaUrl);
          const isFontFile = FONT_EXT.test(mUrlObj.pathname);
          if (!isFontFile && !config.downloadMedia) continue;
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
    enabled: true,
    downloaded: stylesheets.length,
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

function normalizePathnameToPermalink(pathname) {
  const raw = String(pathname || "").trim();
  if (!raw || raw === "/") return "/";
  const clean = `/${raw.replace(/^\/+|\/+$/g, "")}/`;
  return clean === "//" ? "/" : clean;
}

function themeCssIncludeLine(config) {
  if (!config.siteProfile) return "";
  return `  <link rel="stylesheet" href="/${CONFIGURE_THEME_FILE.replace(/\\/g, "/")}">\n`;
}

function buildTargetPermalink(type, slug, config, sourceUrl = "") {
  if (sourceUrl) {
    try {
      const pathname = new URL(sourceUrl).pathname || "/";
      if (pathname === "/" || slug === "home") return "/";
      const normalized = normalizePathnameToPermalink(pathname);
      if (normalized !== "/") return normalized;
    } catch {
      // fall back to generated permalink
    }
  }
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
  const stylesLine = `${config.migrateStyles ? `  {% include "legacy-styles.njk" %}\n` : ""}${themeCssIncludeLine(config)}`;
  const enabled = getEnabledReplacementSlugs(config);
  const languageSwitcherLine = enabled.has("wpml") || enabled.has("gtranslate")
    ? `    {% include "partials/language-switcher.njk" %}\n`
    : "";
  const newsletterLine = enabled.has("newsletter") || enabled.has("mailerlite") || enabled.has("mailchimp")
    ? `  {% include "partials/newsletter-signup.njk" %}\n`
    : "";
  const cookieLine = enabled.has("complianz")
    ? `  {% include "partials/cookie-consent-placeholder.njk" %}\n`
    : "";

  const base = `<!doctype html>
<html lang="{{ site.defaultLocale if site and site.defaultLocale else '${config.locale || "fi"}' }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% if seoTitle %}{{ seoTitle }}{% elif title %}{{ title }} | {{ site.name }}{% else %}{{ site.name }}{% endif %}</title>
  {% set _desc = seoDescription if seoDescription else (ogDescription if ogDescription else excerpt) %}
  {% if _desc %}<meta name="description" content="{{ _desc }}">{% endif %}
  {% set _canonical = canonical if canonical else (site.url + page.url) %}
  <link rel="canonical" href="{{ _canonical }}">
  {% if noindex %}<meta name="robots" content="noindex">{% endif %}
  <meta property="og:type" content="{% if sourceType == 'posts' %}article{% else %}website{% endif %}">
  <meta property="og:url" content="{{ _canonical }}">
  <meta property="og:site_name" content="{{ site.name }}">
  <meta property="og:title" content="{{ ogTitle if ogTitle else (seoTitle if seoTitle else title) }}">
  {% set _ogDesc = ogDescription if ogDescription else _desc %}
  {% if _ogDesc %}<meta property="og:description" content="{{ _ogDesc }}">{% endif %}
  {% if ogImage %}<meta property="og:image" content="{{ ogImage }}">{% endif %}
${stylesLine}</head>
<body>
  {% include "partials/site-header.njk" %}
  {{ content | safe }}
  {% include "partials/site-footer.njk" %}
${newsletterLine}${cookieLine}</body>
</html>
`;

  const page = `---
layout: ${baseLayoutName}
---
<main class="page">
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

const STRIPPED_HTML_ATTRIBUTES = [
  /\sdata-kb-block=(["'])[\s\S]*?\1/gi,
  /\sdata-kadence-id=(["'])[\s\S]*?\1/gi
];
const STRIPPED_CLASS_NAMES = new Set(["kadence-dynamic-icon", "kt-svg-icon-list-single"]);
const LEAF_KADENCE_BLOCKS = new Set(["advancedheading", "listitem", "icon", "image", "spacer", "advancedbtn", "singlebtn", "infobox", "videopopup", "lottie", "countdown", "form", "identity", "posts", "postgrid", "query"]);
const CONTAINER_KADENCE_BLOCKS = new Set(["rowlayout", "column", "iconlist", "tabs", "tab", "accordion", "pane", "gallery", "slider", "slide", "splitcontent", "testimonials", "postcarousel", "portfoliogrid"]);

function convertPaletteToken(value) {
  // Negative lookbehind: skip palette# that is already inside --global-paletteX so we
  // never produce double-wrapped var(--global-var(--global-paletteX)) tokens.
  return String(value || "").replace(/(?<!--global-)palette([1-9])\b/gi, (_, num) => `var(--global-palette${num})`);
}

function transformPaletteValues(input) {
  if (Array.isArray(input)) return input.map((value) => transformPaletteValues(value));
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, transformPaletteValues(value)]));
  }
  return typeof input === "string" ? convertPaletteToken(input) : input;
}

function sanitizeClassName(value) {
  return String(value || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !STRIPPED_CLASS_NAMES.has(token))
    .join(" ");
}

function sanitizeHtmlFragment(html) {
  let result = String(html || "");
  for (const pattern of STRIPPED_HTML_ATTRIBUTES) result = result.replace(pattern, "");
  result = result.replace(/\sclass=(["'])([\s\S]*?)\1/gi, (_full, quote, classes) => {
    const cleaned = sanitizeClassName(classes);
    return cleaned ? ` class=${quote}${cleaned}${quote}` : "";
  });
  // Remove empty anchor tags (e.g. dead WordPress /?page_id=X links with no visible text).
  result = result.replace(/<a\b[^>]*>\s*<\/a>/gi, "");
  // Remove surrounding <p> wrappers that become empty after link removal.
  result = result.replace(/<p[^>]*>\s*<\/p>/gi, "");
  return convertPaletteToken(result);
}

function stripOuterWrapperTag(html) {
  let value = String(html || "").trim();
  const wrapperPattern = /^<([a-z0-9:-]+)([^>]*)>([\s\S]*)<\/\1>$/i;
  while (wrapperPattern.test(value)) {
    const match = value.match(wrapperPattern);
    const attrs = match?.[2] || "";
    if (!/(wp-block-kadence|kadence-|kb-|kt-|kt-inside-inner-col|wp-block-heading|kb-buttons-wrap|kt-svg-icon-list)/i.test(attrs)) break;
    value = String(match?.[3] || "").trim();
  }
  return value;
}

function extractLeafInnerContent(shortName, attrs, innerHtml) {
  if (shortName === "image" || shortName === "spacer") return "";
  if (shortName === "listitem") {
    // Prefer the plain-text `text` attr (available with context=edit).
    if (attrs?.text) return decodeHtml(String(attrs.text));
    // Fallback: extract only the text content from the kt-svg-icon-list-text span
    // to avoid duplicating markup that the listitem.njk template already emits.
    const spanMatch = String(innerHtml || "").match(/<span[^>]*kt-svg-icon-list-text[^>]*>([\s\S]*?)<\/span>/i);
    if (spanMatch) return spanMatch[1].trim();
    return stripOuterWrapperTag(sanitizeHtmlFragment(innerHtml));
  }
  return stripOuterWrapperTag(sanitizeHtmlFragment(innerHtml));
}

function normalizePaneContent(html) {
  // Strip the outer wp-block-kadence-pane wrapper
  let content = stripOuterWrapperTag(html);
  // Strip the WP accordion scaffold: kt-accordion-header-wrap (button+title) and
  // kt-accordion-panel / kt-accordion-panel-inner wrappers — keep only what's inside
  const panelInnerIdx = content.indexOf("kt-accordion-panel-inner");
  if (panelInnerIdx !== -1) {
    const openEnd = content.indexOf(">", panelInnerIdx);
    if (openEnd !== -1) {
      content = content.slice(openEnd + 1);
      // Remove the two closing </div>s for kt-accordion-panel-inner and kt-accordion-panel
      content = content.replace(/<\/div>\s*<\/div>\s*$/, "").trim();
    }
  }
  return content;
}

function extractPaneTitleFromHtml(html) {
  const m = html.match(/<span[^>]*kt-blocks-accordion-title[^>]*>([\s\S]*?)<\/span>/i);
  return m ? m[1].trim() : null;
}

function normalizeKadenceInnerContent(shortName, attrs, innerHtml) {
  const sanitized = sanitizeHtmlFragment(innerHtml);
  if (shortName === "pane") return normalizePaneContent(sanitized);
  if (LEAF_KADENCE_BLOCKS.has(shortName)) return extractLeafInnerContent(shortName, attrs, sanitized);
  if (CONTAINER_KADENCE_BLOCKS.has(shortName)) return stripOuterWrapperTag(sanitized);
  return stripOuterWrapperTag(sanitized);
}

function pickDefinedAttrs(attrs, keys) {
  const source = transformPaletteValues(attrs || {});
  const out = {};
  for (const key of keys) {
    if (source[key] === undefined || source[key] === null || source[key] === "") continue;
    out[key] = key === "className" ? sanitizeClassName(source[key]) : source[key];
  }
  return out;
}

function sanitizeKadenceAttrs(shortName, attrs = {}) {
  switch (shortName) {
    case "advancedheading": {
      const base = pickDefinedAttrs(attrs, ["uniqueID", "level", "align", "color", "fontSizeType", "textTransform", "fontWeight", "className"]);
      // WP stores fontSize as [desktop, tablet, mobile] array — take first non-empty value as scalar.
      const rawFs = attrs?.fontSize;
      if (Array.isArray(rawFs)) {
        const val = rawFs.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
        if (val !== undefined) base.fontSize = String(val).trim();
      } else if (rawFs !== undefined && rawFs !== null && String(rawFs).trim() !== "") {
        base.fontSize = String(rawFs).trim();
      }
      return base;
    }
    case "rowlayout":
      return {
        ...pickDefinedAttrs(attrs, ["uniqueID", "columns", "colLayout", "bgColor", "background", "backgroundImg", "padding", "margin", "bottomSep", "bottomSepColor", "align", "className"]),
        ...(attrs.bgColorClass ? { bgColorClass: sanitizeClassName(attrs.bgColorClass) } : {})
      };
    case "column":
      return pickDefinedAttrs(attrs, ["uniqueID", "width", "colLayout", "padding", "margin", "borderWidth", "borderColor", "background", "className", "verticalAlignment"]);
    case "iconlist":
      return pickDefinedAttrs(attrs, ["uniqueID", "columns", "iconColor", "size", "className"]);
    case "listitem":
      return pickDefinedAttrs(attrs, ["uniqueID", "icon", "text", "iconColor", "className"]);
    case "advancedbtn":
      return pickDefinedAttrs(attrs, ["uniqueID", "hAlign", "className"]);
    case "singlebtn":
      return pickDefinedAttrs(attrs, ["uniqueID", "text", "link", "target", "size", "style", "color", "background", "hAlign", "className"]);
    case "image":
      return pickDefinedAttrs(attrs, ["url", "alt", "width", "height", "link", "linkTarget", "caption", "className"]);
    case "spacer":
      return pickDefinedAttrs(attrs, ["spacerHeight", "dividerEnable", "dividerStyle", "dividerColor", "dividerWidth", "className"]);
    case "infobox":
      return pickDefinedAttrs(attrs, ["uniqueID", "title", "titleLevel", "mediaType", "mediaIcon", "mediaUrl", "linkUrl", "linkTarget", "className"]);
    case "tabs":
    case "tab":
    case "accordion":
    case "pane":
    case "gallery":
    case "slider":
    case "slide":
    case "splitcontent":
    case "testimonials":
    case "postcarousel":
    case "portfoliogrid":
    case "posts":
    case "postgrid":
    case "query":
    case "form":
    case "identity":
    case "videopopup":
    case "lottie":
    case "countdown":
    case "icon":
      return pickDefinedAttrs(attrs, ["uniqueID", "title", "startOpen", "columns", "images", "className", "icon", "showLogo", "showTitle", "showTagline", "fileUrl", "loop", "autoplay", "date", "timezone", "url", "type", "submitLabel", "formTitle"]);
    default:
      return pickDefinedAttrs(attrs, ["uniqueID", "className"]);
  }
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
  if (!state._kbSaveCounter) state._kbSaveCounter = 0;
  return nodes.map((node) => {
    if (node.type === "html") return sanitizeHtmlFragment(node.value);

    const renderedChildren = renderBlockTree(node.children || [], config, warnings, state);
    const [namespace, shortName] = String(node.name || "").split("/");
    if (config.convertKadenceBlocks && namespace === "kadence" && shortName && kadenceSupportedBlocks(config).includes(shortName)) {
      state.convertedCount += 1;
      state.seenBlocks.add(shortName);
      // For pane blocks: extract title from rendered HTML if missing from block attrs
      const rawNodeAttrs = node.attrs || {};
      const resolvedNodeAttrs = (shortName === "pane" && !rawNodeAttrs.title)
        ? { ...rawNodeAttrs, title: extractPaneTitleFromHtml(renderedChildren) || rawNodeAttrs.title }
        : rawNodeAttrs;
      const attrs = sanitizeKadenceAttrs(shortName, resolvedNodeAttrs);
      const innerHtml = normalizeKadenceInnerContent(shortName, attrs, renderedChildren);
      const blockData = safeJsonForNunjucks({
        name: node.name,
        shortName,
        attrs
      });
      const saveVar = `_kb_save_${state._kbSaveCounter++}`;
      return [
        `{% set kadenceBlock = ${blockData} %}`,
        `{% set ${saveVar} = kadenceBlock %}`,
        "{% set kadenceInnerHtml %}",
        innerHtml,
        "{% endset %}",
        `{% set kadenceBlock = ${saveVar} %}`,
        `{% include "blocks/kadence/${shortName}.njk" %}`
      ].join("\n");
    }

    if (config.convertKadenceBlocks && namespace === "kadence" && shortName) {
      if (!state.unknownBlocks.has(shortName)) {
        warnings.push(`Unsupported Kadence block '${shortName}' left as inner HTML fallback.`);
        state.unknownBlocks.add(shortName);
      }
      const strategy = String(config.unknownKadenceBlockStrategy || config.siteProfile?.configure?.unknownKadenceBlockStrategy || "fallback-html");
      if (strategy === "comment-only") {
        return `<!-- TODO: kadence/${shortName} ei tuettu — alkuperäinen sisältö säilytettävä käsin -->`;
      }
      return [
        `<!-- TODO: kadence/${shortName} ei tuettu — alkuperäinen sisältö säilytetty -->`,
        `<div class="block-fallback block-fallback--${slugify(shortName)}" data-original-block="${sanitizeHtmlFragment(node.name)}">`,
        renderedChildren || sanitizeHtmlFragment(String(node.children || "")),
        "</div>"
      ].join("\n");
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

    return renderedChildren;
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
{% if b.fontSize %}
  {# fontSize may be a scalar string or a [desktop,tablet,mobile] array from older migrations #}
  {% if b.fontSize[0] is defined and b.fontSize[0] != "" %}
    {% set fsRaw = b.fontSize[0] %}
  {% elif b.fontSize[0] is defined %}
    {% set fsRaw = "" %}
  {% else %}
    {% set fsRaw = b.fontSize %}
  {% endif %}
  {% if fsRaw == "sm" %}{% set fsCss = "0.875rem" %}
  {% elif fsRaw == "md" %}{% set fsCss = "1rem" %}
  {% elif fsRaw == "lg" %}{% set fsCss = "1.25rem" %}
  {% elif fsRaw == "xl" %}{% set fsCss = "1.75rem" %}
  {% elif fsRaw == "xxl" %}{% set fsCss = "2.25rem" %}
  {% elif fsRaw == "3xl" %}{% set fsCss = "3rem" %}
  {% elif fsRaw %}{% set fsCss = fsRaw ~ (b.fontSizeType if b.fontSizeType else "") %}
  {% endif %}
{% endif %}
<{{ tag }}
  class="kadence-block kadence-advancedheading{% if b.className %} {{ b.className }}{% endif %}{% if b.uniqueID %} kt-adv-heading_{{ b.uniqueID }}{% endif %}"
  {% if b.align or b.color or fsCss or b.textTransform or b.fontWeight %}style="{% if b.align %}text-align:{{ b.align }};{% endif %}{% if b.color %} color:{{ b.color }};{% endif %}{% if fsCss %} font-size:{{ fsCss }};{% endif %}{% if b.textTransform %} text-transform:{{ b.textTransform }};{% endif %}{% if b.fontWeight %} font-weight:{{ b.fontWeight }};{% endif %}"{% endif %}
>{{ kadenceInnerHtml | safe }}</{{ tag }}>
`,

  advancedbtn: `{# kadence/advancedbtn — Button group; innerHtml contains individual button elements #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-advancedbtn kb-btn-align-wrap kb-buttons-wrap{% if b.uniqueID %} kb-btns{{ b.uniqueID }}{% endif %}{% if b.hAlign %} kb-btn-align-{{ b.hAlign }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}"
>
  {{ kadenceInnerHtml | safe }}
</div>
`,

  singlebtn: `{# kadence/singlebtn — Single button block #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-singlebtn kb-btn-wrap{% if b.hAlign %} kb-btn-align-{{ b.hAlign }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}"
>
  <a
    class="kb-button kb-btn{% if b.size %} kb-btn-size-{{ b.size }}{% endif %}{% if b.style %} kb-btn-style-{{ b.style }}{% endif %}"
    href="{{ b.link if b.link else '#' }}"
    {% if b.target and b.target != "_self" %}target="{{ b.target }}"{% endif %}
    {% if b.color or b.background %}style="{% if b.color %}color:{{ b.color }};{% endif %}{% if b.background %} background-color:{{ b.background }};{% endif %}"{% endif %}
  >{{ b.text if b.text else (kadenceInnerHtml | safe) }}</a>
</div>
`,

  rowlayout: `{# kadence/rowlayout — Multi-column section with optional separators #}
{% from "macros/separators.njk" import kbSeparator %}
{% set b = kadenceBlock.attrs %}
{% set cols = b.columns if b.columns else 1 %}
{% set layout = b.colLayout if b.colLayout else "equal" %}
<section
  class="wp-block-kadence-rowlayout kb-row-layout-wrap kadence-block kadence-rowlayout{% if b.uniqueID %} kb-row-layout-id{{ b.uniqueID }}{% endif %}{% if b.align == "full" %} alignfull{% endif %}{% if b.bgColorClass %} kb-theme-{{ b.bgColorClass }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.background or b.bgColor or (b.backgroundImg and b.backgroundImg[0] and b.backgroundImg[0].bgImg) %}style="{% if b.background %}background-color:{{ b.background }};{% endif %}{% if b.bgColor %}background-color:{{ b.bgColor }};{% endif %}{% if b.backgroundImg and b.backgroundImg[0] and b.backgroundImg[0].bgImg %}background-image:url('{{ b.backgroundImg[0].bgImg }}');{% endif %}"{% endif %}
>
  {% if b.topSep and b.topSep != "none" %}
    <div class="kt-row-layout-top-sep kt-svg-for-top-sep" aria-hidden="true"{% if b.topSepColor %} style="color:{{ b.topSepColor }}"{% endif %}>
      {{ kbSeparator(b.topSep) | safe }}
    </div>
  {% endif %}
  <div class="kt-row-layout-overlay"></div>
  <div class="kt-row-column-wrap kb-col-{{ cols }} kb-layout-{{ layout }}">
    {{ kadenceInnerHtml | safe }}
  </div>
  {% if b.bottomSep and b.bottomSep != "none" %}
    <div class="kt-row-layout-bottom-sep kt-svg-for-bottom-sep" aria-hidden="true"{% if b.bottomSepColor %} style="color:{{ b.bottomSepColor }}"{% endif %}>
      {{ kbSeparator(b.bottomSep) | safe }}
    </div>
  {% endif %}
</section>
`,

  column: `{# kadence/column — Single column within a rowlayout #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-column wp-block-kadence-column kb-section-container{% if b.uniqueID %} kb-section_{{ b.uniqueID }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}"
>
  <div class="kt-inside-inner-col">
    {{ kadenceInnerHtml | safe }}
  </div>
</div>
`,

  image: `{# kadence/image — Image with optional link, alt text and caption #}
{% set b = kadenceBlock.attrs %}
<figure
  class="kadence-block kadence-image wp-block-kadence-image kb-image-wrap{% if b.className %} {{ b.className }}{% endif %}"
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
    {{ kadenceInnerHtml | safe }}
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
    {{ kadenceInnerHtml | safe }}
  {% endif %}
</figure>
`,

  slider: `{# kadence/slider — CSS scroll-snap slider fallback #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-slider splide kb-slider-container{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}id="kb-slider-{{ b.uniqueID }}"{% endif %}
  data-slider-mode="css-snap"
>
  <div class="splide__track">
    <ul class="splide__list" style="display:flex;gap:0;overflow-x:auto;scroll-snap-type:x mandatory;list-style:none;padding:0;margin:0;">
      {{ kadenceInnerHtml | safe }}
    </ul>
  </div>
</section>
`,

  slide: `{# kadence/slide — Single slide item #}
{% set b = kadenceBlock.attrs %}
<li
  class="kadence-block kadence-slide splide__slide{% if b.className %} {{ b.className }}{% endif %}"
  style="scroll-snap-align:start;flex:0 0 100%;"
>
  {{ kadenceInnerHtml | safe }}
</li>
`,

  tabs: `{# kadence/tabs — Tab group with title nav and switchable panels #}
{% set b = kadenceBlock.attrs %}
<div class="wp-block-kadence-tabs kb-tabs{% if b.uniqueID %} kb-tabs-id_{{ b.uniqueID }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}">
  {{ kadenceInnerHtml | safe }}
</div>
<script>
(function () {
  if (window._ktTabsInit) return;
  window._ktTabsInit = true;
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.wp-block-kadence-tabs.kb-tabs').forEach(function (wrap) {
      var panels = Array.from(wrap.querySelectorAll('.kt-tabs-content-wrap > .kb-tab-panel'));
      var titleItems = Array.from(wrap.querySelectorAll('.kt-tabs-title-list .kt-title-item'));
      var titleLinks = Array.from(wrap.querySelectorAll('.kt-tabs-title-list .kt-tab-title'));
      function activate(idx) {
        panels.forEach(function (p, i) { p.classList.toggle('kt-tab-active', i === idx); });
        titleItems.forEach(function (li, i) {
          li.classList.toggle('kt-tab-title-active', i === idx);
          li.classList.toggle('kt-tab-title-inactive', i !== idx);
        });
      }
      var initIdx = titleItems.findIndex(function (li) { return li.classList.contains('kt-tab-title-active'); });
      activate(initIdx >= 0 ? initIdx : 0);
      titleLinks.forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          var tabNum = parseInt(link.getAttribute('data-tab'), 10);
          if (!isNaN(tabNum)) activate(tabNum - 1);
        });
      });
    });
  });
}());
</script>
`,

  tab: `{# kadence/tab — Single tab panel, shown/hidden by tabs.njk JS #}
{% set b = kadenceBlock.attrs %}
<div
  class="wp-block-kadence-tab kb-tab-panel{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}id="kt-tab_{{ b.uniqueID }}"{% endif %}
  role="tabpanel"
>
  {{ kadenceInnerHtml | safe }}
</div>
`,

  accordion: `{# kadence/accordion — Accordion wrapper with Kadence-compatible button+panel toggle #}
{% set b = kadenceBlock.attrs %}
<div class="wp-block-kadence-accordion kb-accordion{% if b.uniqueID %} kb-accordion-id_{{ b.uniqueID }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}"
  data-allow-multiple-open="{{ 'true' if b.allowMultipleOpen else 'false' }}"
  data-start-open="{{ 'true' if b.startOpen else 'false' }}"
>
  {{ kadenceInnerHtml | safe }}
</div>
<script>
(function () {
  if (typeof window._ktAccordionInit === 'undefined') {
    window._ktAccordionInit = true;
    document.addEventListener('DOMContentLoaded', function () {
      document.querySelectorAll('.wp-block-kadence-accordion').forEach(function (wrap) {
        var allowMultiple = wrap.getAttribute('data-allow-multiple-open') === 'true';
        wrap.querySelectorAll('.kt-accordion-header-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var pane = btn.closest('.kt-accordion-pane');
            var isOpen = pane.classList.contains('is-open');
            if (!allowMultiple) {
              wrap.querySelectorAll('.kt-accordion-pane.is-open').forEach(function (p) {
                p.classList.remove('is-open');
                p.querySelector('.kt-accordion-header-btn').setAttribute('aria-expanded', 'false');
              });
            }
            if (!isOpen) {
              pane.classList.add('is-open');
              btn.setAttribute('aria-expanded', 'true');
            }
          });
        });
      });
    });
  }
}());
</script>
`,

  pane: `{# kadence/pane — Accordion pane with Kadence button+panel structure #}
{% set b = kadenceBlock.attrs %}
<div class="wp-block-kadence-pane kt-accordion-pane{% if b.startOpen %} is-open{% endif %}{% if b.className %} {{ b.className }}{% endif %}">
  <div class="kt-accordion-heading kt-accordion-header-wrap">
    <button class="kt-accordion-header kt-accordion-header-btn"
      aria-expanded="{{ 'true' if b.startOpen else 'false' }}"
      {% if b.uniqueID %}aria-controls="kb-panel-{{ b.uniqueID }}"{% endif %}
    >
      {% if b.title %}<span class="kt-blocks-accordion-title">{{ b.title }}</span>{% endif %}
      <span class="kt-accordion-icon-trigger" aria-hidden="true"></span>
    </button>
  </div>
  <div class="kt-accordion-panel"{% if b.uniqueID %} id="kb-panel-{{ b.uniqueID }}"{% endif %} role="region">
    <div class="kt-accordion-panel-inner">
      {{ kadenceInnerHtml | safe }}
    </div>
  </div>
</div>
`,

  infobox: `{# kadence/infobox — Info card with link-wrap, optional media, title and body #}
{% set b = kadenceBlock.attrs %}
{% from "macros/feather-icons.njk" import featherIcon %}
<div class="wp-block-kadence-infobox kt-blocks-info-box-wrap{% if b.uniqueID %} kt-info-box_{{ b.uniqueID }}{% endif %}{% if b.className %} {{ b.className }}{% endif %}">
  {% if b.linkUrl %}
    <a href="{{ b.linkUrl }}"{% if b.linkTarget %} target="{{ b.linkTarget }}"{% endif %} class="kt-blocks-info-box-link-wrap">
  {% else %}
    <div class="kt-blocks-info-box-link-wrap kt-blocks-info-box-link-wrap-hover-only">
  {% endif %}
    {% if b.mediaType == "icon" and b.mediaIcon %}
      <div class="kt-blocks-info-box-media-container kt-info-box-image">
        <div class="kt-info-svg-div">{{ featherIcon(b.mediaIcon) }}</div>
      </div>
    {% elif b.mediaType == "image" and b.mediaUrl %}
      <div class="kt-blocks-info-box-media-container kt-info-box-image">
        <div class="kt-info-box-img-wrap"><img src="{{ b.mediaUrl }}" alt="{{ b.title if b.title else '' }}" class="kb-info-box-image"></div>
      </div>
    {% endif %}
    <div class="kt-infobox-textcontent">
      {% if b.title %}
        {% set tag = "h" ~ (b.titleLevel if b.titleLevel else 3) %}
        <{{ tag }} class="kt-blocks-info-box-title">{{ b.title }}</{{ tag }}>
      {% endif %}
      <div class="kt-blocks-info-box-body">{{ kadenceInnerHtml | safe }}</div>
    </div>
  {% if b.linkUrl %}
    </a>
  {% else %}
    </div>
  {% endif %}
</div>
`,

  icon: `{# kadence/icon — Single icon; innerHtml contains the rendered SVG or icon font markup #}
{% set b = kadenceBlock.attrs %}
{% from "macros/feather-icons.njk" import featherIcon %}
<span
  class="kadence-block kadence-icon{% if b.className %} {{ b.className }}{% endif %}"
  aria-hidden="true"
>
  {% if b.icon %}{{ featherIcon(b.icon) }}{% else %}{{ kadenceInnerHtml | safe }}{% endif %}
</span>
`,

  iconlist: `{# kadence/iconlist — List with icon bullets; items are kadence/listitem blocks #}
{% set b = kadenceBlock.attrs %}
<ul
  class="kadence-block kadence-iconlist kt-svg-icon-list-items kt-svg-icon-list-columns-{{ b.columns if b.columns else 1 }} alignnone{% if b.className %} {{ b.className }}{% endif %}"
>
  {{ kadenceInnerHtml | safe }}
</ul>
`,

  listitem: `{# kadence/listitem — Single icon list item #}
{% set b = kadenceBlock.attrs %}
{% from "macros/feather-icons.njk" import featherIcon %}
<li class="kadence-block kadence-listitem kt-svg-icon-list-item-wrap{% if b.className %} {{ b.className }}{% endif %}">
  {% if b.icon %}
    {{ featherIcon(b.icon) }}
  {% endif %}
  <span class="kt-svg-icon-list-text">{{ kadenceInnerHtml | safe }}</span>
</li>
`,

  spacer: `{# kadence/spacer — Vertical spacer with optional horizontal rule #}
{% set b = kadenceBlock.attrs %}
{% set h = b.spacerHeight[0] if (b.spacerHeight and b.spacerHeight[0]) else 60 %}
<div
  class="kadence-block kadence-spacer kt-block-spacer{% if b.className %} {{ b.className }}{% endif %}"
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

  posts: `{# kadence/posts — Eleventy collection fallback for dynamic posts block #}
{% set b = kadenceBlock.attrs %}
{% set count = b.postsToShow if b.postsToShow else (b.numberOfItems if b.numberOfItems else 3) %}
<section class="kadence-block kadence-posts kb-posts-block{% if b.className %} {{ b.className }}{% endif %}">
  {% if kadenceInnerHtml | trim %}
    {{ kadenceInnerHtml | safe }}
  {% else %}
    {% for post in collections.posts | reverse %}
      {% if loop.index <= count %}
        <article class="kb-posts-item">
          <h3><a href="{{ post.url }}">{{ post.data.title }}</a></h3>
          {% if post.data.excerpt %}<p>{{ post.data.excerpt }}</p>{% endif %}
        </article>
      {% endif %}
    {% endfor %}
  {% endif %}
</section>
`,

  postgrid: `{# kadence/postgrid — Eleventy collection grid fallback for dynamic posts block #}
{% set b = kadenceBlock.attrs %}
{% set count = b.postsToShow if b.postsToShow else (b.numberOfItems if b.numberOfItems else 6) %}
<section class="kadence-block kadence-postgrid kb-post-grid{% if b.className %} {{ b.className }}{% endif %}">
  {% if kadenceInnerHtml | trim %}
    {{ kadenceInnerHtml | safe }}
  {% else %}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1.25rem;">
      {% for post in collections.posts | reverse %}
        {% if loop.index <= count %}
          <article class="kb-post-grid-item">
            <h3><a href="{{ post.url }}">{{ post.data.title }}</a></h3>
            {% if post.data.excerpt %}<p>{{ post.data.excerpt }}</p>{% endif %}
          </article>
        {% endif %}
      {% endfor %}
    </div>
  {% endif %}
</section>
`,

  query: `{# kadence/query — Post list with client-side load-more (replaces WP infinite scroll) #}
{% set b = kadenceBlock.attrs %}
{% set _pageSize = b.postsToShow if b.postsToShow else (b.numberOfItems if b.numberOfItems else 10) %}
{% set _col = b.collectionName if b.collectionName else "posts" %}
{% set _uid = b.uniqueID if b.uniqueID else (_col + "-query") %}
<section class="wp-block-kadence-query kb-query-loop{% if b.className %} {{ b.className }}{% endif %}" data-kb-query-id="{{ _uid }}">
  {% if kadenceInnerHtml | trim %}
    {{ kadenceInnerHtml | safe }}
  {% else %}
    <div class="kb-query-grid" id="kb-query-grid-{{ _uid }}">
      {% for post in collections[_col] %}
        <article class="kb-query-item{% if loop.index > _pageSize %} kb-query-hidden{% endif %}">
          {% if post.data.featuredImage %}
            <a href="{{ post.url }}" class="kb-query-item__thumb" tabindex="-1" aria-hidden="true">
              <img src="{{ post.data.featuredImage }}" alt="{{ post.data.title }}" loading="lazy">
            </a>
          {% endif %}
          <div class="kb-query-item__body">
            {% if post.data.categories and post.data.categories.length %}
              <div class="kb-query-item__cats">
                {% for cat in post.data.categories | first(1) %}<span class="kb-query-item__cat">{{ cat }}</span>{% endfor %}
              </div>
            {% endif %}
            <h3 class="kb-query-item__title"><a href="{{ post.url }}">{{ post.data.title }}</a></h3>
            {% if post.data.date %}
              <time class="kb-query-item__date" datetime="{{ post.data.date }}">{{ post.data.date | date("d.m.Y") }}</time>
            {% endif %}
            {% if post.data.excerpt and post.data.excerpt != "[object Object]" %}
              <p class="kb-query-item__excerpt">{{ post.data.excerpt | truncate(160) }}</p>
            {% endif %}
          </div>
        </article>
      {% endfor %}
    </div>
    {% set _total = collections[_col] | length %}
    {% if _total > _pageSize %}
      <div class="kb-query-sentinel" id="kb-query-sentinel-{{ _uid }}" data-grid="kb-query-grid-{{ _uid }}" data-page-size="{{ _pageSize }}" aria-hidden="true"></div>
    {% endif %}
  {% endif %}
</section>
<script>
(function () {
  if (window._kbInfiniteInit) return;
  window._kbInfiniteInit = true;
  document.addEventListener('DOMContentLoaded', function () {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.kb-query-hidden').forEach(function (el) { el.classList.remove('kb-query-hidden'); });
      return;
    }
    document.querySelectorAll('.kb-query-sentinel').forEach(function (sentinel) {
      var grid = document.getElementById(sentinel.dataset.grid);
      var pageSize = parseInt(sentinel.dataset.pageSize, 10) || 10;
      if (!grid) return;
      var observer = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        var hidden = Array.from(grid.querySelectorAll('.kb-query-hidden'));
        hidden.slice(0, pageSize).forEach(function (el) { el.classList.remove('kb-query-hidden'); });
        if (grid.querySelector('.kb-query-hidden')) {
          requestAnimationFrame(function () { observer.observe(sentinel); });
        }
      }, { rootMargin: '200px' });
      observer.observe(sentinel);
    });
  });
}());
</script>
`,

  testimonials: `{# kadence/testimonials — Testimonials grid; items are kadence/testimonial blocks #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-testimonials{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {{ kadenceInnerHtml | safe }}
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
    {{ kadenceInnerHtml | safe }}
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
    {{ kadenceInnerHtml | safe }}
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
  {{ kadenceInnerHtml | safe }}
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
      {{ kadenceInnerHtml | safe }}
    </a>
  {% else %}
    {{ kadenceInnerHtml | safe }}
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
    {{ kadenceInnerHtml | safe }}
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
      {{ kadenceInnerHtml | safe }}
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
      {{ kadenceInnerHtml | safe }}
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
    {{ kadenceInnerHtml | safe }}
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
  {{ kadenceInnerHtml | safe }}
</details>
`,

  dynamichtml: `{# kadence/dynamichtml (PRO) — Dynamic query block; replace with an Eleventy collection loop #}
{% set b = kadenceBlock.attrs %}
<div
  class="kadence-block kadence-dynamichtml{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {# TODO: replace with Eleventy collection loop — e.g. {% for post in collections.posts %} #}
  {{ kadenceInnerHtml | safe }}
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
  {{ kadenceInnerHtml | safe }}
</aside>
`,

  splitcontent: `{# kadence/splitcontent (PRO) — Two-column split layout (e.g. media + text) #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-splitcontent{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {{ kadenceInnerHtml | safe }}
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
  {{ kadenceInnerHtml | safe }}
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
  {{ kadenceInnerHtml | safe }}
</section>
`,

  portfoliogrid: `{# kadence/portfoliogrid (PRO) — Portfolio grid; replace with an Eleventy collection loop #}
{% set b = kadenceBlock.attrs %}
<section
  class="kadence-block kadence-portfoliogrid{% if b.className %} {{ b.className }}{% endif %}"
  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}
>
  {# TODO: replace with Eleventy portfolio collection loop #}
  {{ kadenceInnerHtml | safe }}
</section>
`
};

function kadencePartialTemplate(name) {
  const rawBase = Object.prototype.hasOwnProperty.call(KADENCE_PARTIAL_TEMPLATES, name)
    ? KADENCE_PARTIAL_TEMPLATES[name]
    : `{# kadence/${name} — Generic fallback. Customize this partial. #}\n{% set b = kadenceBlock.attrs %}\n<div\n  class="kadence-block kadence-${name}{% if b.className %} {{ b.className }}{% endif %}"\n  {% if b.uniqueID %}data-kadence-id="{{ b.uniqueID }}"{% endif %}\n>\n  {{ kadenceInnerHtml | safe }}\n</div>\n`;
  const raw = rawBase.replace(/\n\s*\{% if b\.uniqueID %\}data-kadence-id="\{\{ b\.uniqueID \}\}"\{% endif %\}/g, "");

  // Inject standard WordPress block class, Kadence kb-* class and uniqueID-scoped class.
  // Only inject each class if it is NOT already present in the explicit template — explicit templates
  // may include some or all of these already, and double-injecting produces broken markup.
  const css = KADENCE_BLOCK_CSS[name] || {};
  const wpClass = `wp-block-kadence-${name}`;

  const wpAlready  = raw.includes(wpClass);
  const kbAlready  = css.wrap ? raw.includes(css.wrap) : true;
  const uidAlready = css.uid  ? raw.includes(`${css.uid}_`) : true;

  // Build prefix string from only the missing classes.
  const prefixParts = [];
  if (!wpAlready)  prefixParts.push(wpClass);
  if (!kbAlready)  prefixParts.push(css.wrap);
  const uidFrag = (!uidAlready && css.uid) ? `{% if b.uniqueID %} ${css.uid}_{{ b.uniqueID }}{% endif %}` : "";

  // If nothing needs injecting, return the template unchanged.
  if (!prefixParts.length && !uidFrag) return raw;

  // The templates open with: class="kadence-block kadence-{name} (or kadence-toc for table-of-contents)
  const needle = raw.includes(`class="kadence-block kadence-${name}`)
    ? `class="kadence-block kadence-${name}`
    : `class="kadence-block kadence-toc`; // table-of-contents shorthand
  const replacement = `class="${prefixParts.length ? prefixParts.join(" ") + " " : ""}kadence-block kadence-${name}${uidFrag}`;
  return raw.replace(needle, replacement);
}

function featherIconMacroTemplate() {
  return `{% macro featherIcon(name) -%}
{% set iconName = (name | replace("fe_", "") | lower) %}
<span class="feather-icon feather-icon-{{ iconName }}" aria-hidden="true">
  {% if iconName == "check" %}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
  {% elif iconName == "star" %}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 9 16.5 14 18.5 22 12 17.8 5.5 22 7.5 14 2 9 9 9 12 2"></polygon></svg>
  {% elif iconName == "menu" %}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
  {% elif iconName == "x" %}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
  {% elif iconName == "arrow-right" %}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
  {% else %}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle></svg>
  {% endif %}
</span>
{%- endmacro %}
`;
}

function separatorMacroTemplate() {
  const cases = Object.entries(SEPARATOR_SVG_TEMPLATES)
    .map(([name, svg], i) => `  ${ i === 0 ? "{% if" : "{% elif"} name == "${name}" %}${svg}`)
    .join("\n");
  return `{% macro kbSeparator(name) -%}
${cases}
  {% endif %}
{%- endmacro %}
`;
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
  const macroDir = path.join(outputRoot, "_includes", "macros");
  await fs.mkdir(macroDir, { recursive: true });
  await fs.writeFile(path.join(macroDir, "feather-icons.njk"), featherIconMacroTemplate(), "utf8");
  await fs.writeFile(path.join(macroDir, "separators.njk"), separatorMacroTemplate(), "utf8");
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
  const excerpt = stripHtml(item?.excerpt?.rendered || (typeof item?.excerpt === "string" ? item.excerpt : "") || "");
  const categories = Array.isArray(item?.categories) ? item.categories.map((id) => categoryMap.get(id)).filter(Boolean) : [];
  const tags = Array.isArray(item?.tags) ? item.tags.map((id) => tagMap.get(id)).filter(Boolean) : [];
  const rawBlockContent = item?.content?.raw || "";
  const renderedHtml = item?.content?.rendered || item?.content || "";
  const permalink = buildTargetPermalink(type, slug, config, item?.link || "");
  const layout = resolveLayoutForType(type, config);
  let body = config.htmlMode === "basic-markdown" ? basicHtmlToMarkdown(renderedHtml) : String(renderedHtml).trim();
  let fileExtension = "md";
  let kadenceBlocks = [];
  let unknownKadenceBlocks = [];
  let convertedKadenceBlocks = false;

  if (config.convertKadenceBlocks) {
    if (rawBlockContent) {
      const converted = convertKadenceBlocksToNunjucks(rawBlockContent, config, warnings);
      if (converted.usedNunjucks) {
        body = converted.body;
        fileExtension = "njk";
        kadenceBlocks = converted.seenBlocks;
        unknownKadenceBlocks = converted.unknownBlocks;
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
    permalink,
    status: item?.status || "publish",
    sourceType: type,
    sourceId: item?.id || "",
    sourceUrl: item?.link || "",
    excerpt,
    categories,
    tags
  };
  if (config.lang) frontMatter.lang = config.lang;
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
    convertedKadenceBlocks,
    unknownKadenceBlocks,
    shortcodes
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
    warnings: [],
    actionItems: {
      unsupportedBlocks: [],
      shortcodes: [],
      suggestions: []
    },
    workflow: ["discover", "configure", "migrate"],
    styles: { enabled: Boolean(config.migrateStyles) },
    kadenceBlocks: { enabled: Boolean(config.convertKadenceBlocks) }
  };

  if (config.sourceType !== "rest") {
    report.warnings.push(`Source type '${config.sourceType}' is not implemented yet. Use 'rest'.`);
    return report;
  }

  progress("info", `Migraatio käynnistetty → ${config.wpBaseUrl}`);
  progress("info", `Tulostehakemisto: ${config.outputRoot}${config.dryRun ? " (dry run)" : ""}`);

  const root = path.resolve(process.cwd(), config.outputRoot);
  const contentRoot = config.langPrefix
    ? path.join(root, config.contentDir, config.langPrefix)
    : path.join(root, config.contentDir);
  const mediaRoot = path.join(root, config.mediaDir);
  const dataRoot = path.join(root, config.dataDir || DEFAULT_DATA_DIR);
  const kadencePartialsPath = path.join(root, config.kadenceBlocksDir || DEFAULT_KADENCE_BLOCKS_DIR);
  await fs.mkdir(contentRoot, { recursive: true });
  if (config.downloadMedia || config.migrateStyles) await fs.mkdir(mediaRoot, { recursive: true });
  if (config.importMenus) await fs.mkdir(dataRoot, { recursive: true });

  if (config.siteProfile) {
    const artifacts = config.dryRun ? { configureSummary: buildConfigureSummary(config.siteProfile) } : await writeSiteProfileArtifacts(root, config.siteProfile, progress);
    report.siteProfile = {
      profilePath: artifacts.profilePath || path.join(root, PROFILE_FILE_NAME),
      summaryPath: artifacts.summaryPath || path.join(root, PROFILE_SUMMARY_FILE_NAME),
      summary: artifacts.configureSummary || buildConfigureSummary(config.siteProfile)
    };
    await configureProjectFromProfile(root, config, report, progress);
  }

  // bootstrapEleventyProject called after category fetch so collections can be generated
  await writeReplacementScaffolding(root, config, report, progress);

  if (config.convertKadenceBlocks) {
    const allKadenceBlocks = config.preset === "kadence-pro"
      ? [...SUPPORTED_KADENCE_BLOCKS, ...SUPPORTED_KADENCE_PRO_BLOCKS]
      : SUPPORTED_KADENCE_BLOCKS;
    report.kadenceBlocks = {
      enabled: true,
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
  const langParam = config.lang ? `?lang=${encodeURIComponent(config.lang)}` : "";
  const langSep = config.lang ? `?lang=${encodeURIComponent(config.lang)}&` : "?";

  progress("info", "Haetaan taksonomiat (kategoriat, tagit)…");
  printStep("fetch", `Taxonomies from ${baseApi}`);
  const [cats, tags] = await Promise.all([
    fetchAllPages(`${baseApi}/categories${langParam}`, headers).catch(() => []),
    fetchAllPages(`${baseApi}/tags${langParam}`, headers).catch(() => [])
  ]);
  const categoryMap = new Map(cats.map((c) => [c.id, c.name]));
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));
  progress("ok", `Taksonomiat: ${cats.length} kategoriaa, ${tags.length} tagia`);

  const categoryNames = cats.map((c) => c.name).filter(Boolean);
  await bootstrapEleventyProject(root, config, report, progress, categoryNames);
  await installProjectDependencies(root, config, report, progress);

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

    let finalMenus = menuResult.menus;

    if (!finalMenus.length) {
      // Fallback: parse nav structure from rendered homepage HTML
      progress("warn", "REST API ei palauttanut valikoita — yritetään parsia renderöidystä HTML:stä…");
      try {
        const homepageHtml = await fetchText(ensureTrailingSlash(config.wpBaseUrl), headers);
        const parsedNavs = extractNavFromHtml(homepageHtml, config.wpBaseUrl);
        if (parsedNavs.length) {
          finalMenus = parsedNavs.map((nav, i) => ({
            id: nav.id || `parsed-nav-${i}`,
            slug: nav.id || `parsed-nav-${i}`,
            title: nav.ariaLabel || `Navigation ${i + 1}`,
            location: "",
            items: nav.items,
          }));
          report.menus.source = "html-fallback";
          report.menus.imported = finalMenus.length;
          progress("ok", `Valikot parsittu HTML:stä: ${finalMenus.length} kpl`);
        } else {
          report.warnings.push("No menu structure was imported. WordPress menus often need a dedicated menu REST endpoint or plugin.");
          progress("warn", "Valikkoja ei löydetty REST API:sta eikä HTML:stä");
        }
      } catch (err) {
        report.warnings.push(`Menu HTML fallback failed: ${String(err.message || err)}`);
        progress("warn", `Valikkojen parsinta epäonnistui: ${err.message}`);
      }
    }

    // Augment with Kadence Pro megamenu data from kadence_navigation post type
    if (config.authMode !== "none") {
      try {
        progress("info", "Haetaan Kadence-navigaatiot (megamenu)…");
        const kadenceHeaders = await fetchKadenceHeaders(config, headers);
        const kadenceNavs = await fetchKadenceNavigations(config, headers);
        if (kadenceNavs.length) {
          // Find the nav id used in the active header
          let mainNavId = null;
          for (const kh of kadenceHeaders) {
            mainNavId = findNavIdInHeaderContent(kh.content);
            if (mainNavId) break;
          }
          const mainNavTemplate = mainNavId
            ? kadenceNavs.find((n) => n.id === mainNavId)
            : kadenceNavs[0];
          if (mainNavTemplate) {
            const kadenceNavItems = parseKadenceNavLinks(mainNavTemplate.content, config.wpBaseUrl);
            finalMenus = mergeKadenceMegamenuIntoNav(finalMenus, kadenceNavItems);
            const megamenuCount = kadenceNavItems.filter((i) => i.isMegaMenu).length;
            if (megamenuCount) {
              progress("ok", `Kadence megamenu: ${megamenuCount} kohde(tta) lisätty`);
            }
          }
        }
      } catch (err) {
        report.warnings.push(`Kadence navigation fetch failed: ${String(err.message || err)}`);
      }
    }

    if (finalMenus.length) {
      const navigationPath = path.join(dataRoot, "navigation.json");
      report.menus.outputPath = navigationPath;
      report.menus.imported = finalMenus.length;
      if (!config.dryRun) await fs.writeFile(navigationPath, `${JSON.stringify(finalMenus, null, 2)}\n`, "utf8");
      if (menuResult.menus.length) {
        progress("ok", `Valikot: ${finalMenus.length} kpl (lähde: ${menuResult.source})`);
      }
    }
  }

  await writeEleventyPluginPlan(root, config, report, progress);

  for (const type of config.contentTypes) {
    const typeSlug = slugify(type);
    const endpointBase = `${baseApi}/${type}`;
    const baseWithEmbed = `${endpointBase}${langSep}_embed=1`;
    const endpoint = config.authMode !== "none"
      ? `${endpointBase}${langSep}context=edit&_embed=1`
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

    // Write Eleventy directory data file so collections.posts works out of the box.
    if (typeSlug === "posts" && !config.dryRun) {
      const layout = resolveLayoutForType("posts", config);
      const postTag = config.langPrefix ? `posts-${config.langPrefix}` : "posts";
      const dirData = { tags: ["posts", postTag], ...(config.lang ? { lang: config.lang } : {}), ...(layout ? { layout } : {}) };
      await writeIfMissing(path.join(outTypeDir, "posts.json"), `${JSON.stringify(dirData, null, 2)}\n`);
    }

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

      if (doc.unknownKadenceBlocks?.length) {
        report.actionItems.unsupportedBlocks.push({
          document: `${typeSlug}/${fileName}`,
          sourceUrl: item?.link || "",
          blocks: doc.unknownKadenceBlocks,
          suggestion: doc.unknownKadenceBlocks.some((name) => name === "slider" || name === "slide")
            ? "Tarkista slider-rakenne ja harkitse Splide JS -integraatiota, jos CSS-scroll-snap ei riita."
            : "Luo puuttuva Nunjucks-partial tai pidä fallback-HTML valiaikaisena ratkaisuna."
        });
      }
      if (doc.shortcodes?.length) {
        report.actionItems.shortcodes.push({
          document: `${typeSlug}/${fileName}`,
          sourceUrl: item?.link || "",
          shortcodes: doc.shortcodes
        });
      }

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

  if (report.actionItems.unsupportedBlocks.some((entry) => entry.blocks.includes("slider") || entry.blocks.includes("slide"))) {
    report.actionItems.suggestions.push("Kadence slider/slide on muutettu CSS scroll-snap -versioksi. Jos alkuperainen Splide-kayttaytyminen tarvitaan, lisaa Splide JS base-layoutiin.");
  }
  if (report.actionItems.unsupportedBlocks.length) {
    report.actionItems.suggestions.push("Tarkista report.actionItems.unsupportedBlocks ja toteuta puuttuvat blokkipartiaalit ensiksi eniten kaytettyihin lohkoihin.");
  }
  if (report.actionItems.shortcodes.length) {
    report.actionItems.suggestions.push("Shortcode-viittaukset vaativat manuaalista korvausta Eleventy-komponenteilla tai staattisella HTML:lla.");
  }

  await verifyProjectOutput(root, config, report, progress);

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
  const localProjectFolder = String(raw.localProjectFolder || "").trim();
  const outputRoot = resolveOutputRoot(raw.outputRoot, localProjectFolder, stamp);
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
    siteMode: ["new", "existing"].includes(String(raw.siteMode || "new")) ? String(raw.siteMode || "new") : "new",
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
    eleventyReplacements: normalizeEleventyReplacements(raw.eleventyReplacements),
    siteProfile: raw.siteProfile && typeof raw.siteProfile === "object" ? raw.siteProfile : null,
    unknownKadenceBlockStrategy: String(
      raw.unknownKadenceBlockStrategy
      || raw.siteProfile?.configure?.unknownKadenceBlockStrategy
      || "fallback-html"
    ),
    localProjectFolder,
    outputRoot,
    contentDir: String(raw.contentDir || "content").trim() || "content",
    mediaDir: String(raw.mediaDir || "media").trim() || "media",
    dataDir: String(raw.dataDir || DEFAULT_DATA_DIR).trim() || DEFAULT_DATA_DIR,
    lang: String(raw.lang || "").trim().toLowerCase(),
    langPrefix: String(raw.langPrefix || raw.lang || "").trim().toLowerCase()
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

function resolveOutputRoot(rawOutputRoot, localProjectFolder, stamp = nowStamp()) {
  const fallback = `./migrations/wp-to-eleventy-${stamp}`;
  const localRoot = String(localProjectFolder || "").trim();
  const rawRoot = String(rawOutputRoot || "").trim();
  if (!rawRoot) return localRoot || fallback;
  if (path.isAbsolute(rawRoot)) return rawRoot;
  if (localRoot && path.isAbsolute(localRoot)) {
    if (rawRoot === path.basename(localRoot)) return localRoot;
    if (rawRoot === "." || rawRoot === "./") return localRoot;
  }
  return rawRoot;
}

async function pickFolderPath(initialPath = "") {
  const platform = process.platform;
  const normalizedInitialPath = String(initialPath || "").trim().replace(/\/+$/, "");
  if (platform === "darwin") {
    const hasInitial = normalizedInitialPath && path.isAbsolute(normalizedInitialPath);
    const defaultLocation = hasInitial
      ? ` default location POSIX file ${JSON.stringify(normalizedInitialPath)}`
      : "";
    const script = `POSIX path of (choose folder with prompt "Valitse projektikansio"${defaultLocation})`;
    const folder = await new Promise((resolve, reject) => {
      execFile("osascript", ["-e", script], { encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          if (String(stderr || error.message || "").includes("User canceled")) {
            const cancelError = new Error("Folder picker cancelled");
            cancelError.code = "ABORT_ERR";
            reject(cancelError);
            return;
          }
          reject(error);
          return;
        }
        resolve(String(stdout || "").trim());
      });
    });
    return folder.replace(/\/+$/, "");
  }

  if (platform === "win32") {
    const command = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$dialog.Description = "Select project folder"',
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }"
    ].join("; ");
    const folder = await new Promise((resolve, reject) => {
      execFile("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const value = String(stdout || "").trim();
        if (!value) {
          const cancelError = new Error("Folder picker cancelled");
          cancelError.code = "ABORT_ERR";
          reject(cancelError);
          return;
        }
        resolve(value);
      });
    });
    return String(folder).replace(/[\\/]+$/, "");
  }

  const folder = await new Promise((resolve, reject) => {
    execFile("zenity", ["--file-selection", "--directory", "--title=Select project folder"], { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        if (error.code === 1) {
          const cancelError = new Error("Folder picker cancelled");
          cancelError.code = "ABORT_ERR";
          reject(cancelError);
          return;
        }
        reject(error);
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
  return String(folder).replace(/\/+$/, "");
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
    "siteMode",
    "localProjectFolder", "localDevCommand", "localSiteUrl",
    "githubOwner", "githubRepo", "pagesUrl", "buildCommand",
    "useGitHubActions", "publishOnPush",
    "useCustomDomain", "domainAction", "desiredDomain", "registrar", "dnsNotes"
  ];
  const plan = {};
  for (const k of keys) if (body[k] !== undefined) plan[k] = body[k];
  return plan;
}

async function analyzeWordPressSite(raw) {
  const wpBaseUrl = String(raw.wpBaseUrl || "").trim().replace(/\/+$/, "");
  if (!wpBaseUrl) throw new Error("wpBaseUrl puuttuu");

  const authMode = String(raw.authMode || "none");
  const headers = {};
  if (authMode === "app-password" && raw.wpUser && raw.wpAppPassword) {
    headers.Authorization = `Basic ${Buffer.from(`${raw.wpUser}:${raw.wpAppPassword}`).toString("base64")}`;
  } else if (authMode === "bearer" && raw.wpBearerToken) {
    headers.Authorization = `Bearer ${raw.wpBearerToken}`;
  }

  const warnings = [];

  // 1. WP REST root
  let root;
  try {
    root = await fetchJson(`${wpBaseUrl}/wp-json`, headers);
  } catch (err) {
    throw new Error(`WP REST API ei vastaa: ${err.message}`);
  }

  const namespaces = root.namespaces || [];
  const siteInfo = {
    title: root.name || "",
    description: root.description || "",
    url: root.url || wpBaseUrl,
    home: root.home || wpBaseUrl,
    gmtOffset: root.gmt_offset,
    timezone: root.timezone_string || "",
  };

  // 2. Content types and counts
  let typesData = {};
  try {
    typesData = await fetchJson(`${wpBaseUrl}/wp-json/wp/v2/types`, headers);
  } catch {
    warnings.push("Sisältötyyppien haku epäonnistui — käytetään oletuksia (posts, pages).");
  }

  const contentInventory = {};
  const publicTypes = Object.entries(typesData).filter(([, t]) => t?.rest_base);
  for (const [slug, typeInfo] of publicTypes) {
    try {
      const resp = await fetch(`${wpBaseUrl}/wp-json/wp/v2/${typeInfo.rest_base}?per_page=1&status=publish`, { headers });
      const total = parseInt(resp.headers.get("X-WP-Total") || "0", 10);
      contentInventory[slug] = { count: total, label: typeInfo.name || slug, restBase: typeInfo.rest_base };
    } catch {
      contentInventory[slug] = { count: 0, label: typeInfo.name || slug, restBase: typeInfo.rest_base };
    }
  }
  if (!Object.keys(contentInventory).length) {
    contentInventory.posts = { count: 0, label: "Posts", restBase: "posts" };
    contentInventory.pages = { count: 0, label: "Pages", restBase: "pages" };
  }

  // 3. Detect preset from namespaces
  const hasKadencePro = namespaces.some((ns) => ns.startsWith("kadence-pro"));
  const hasKadence = namespaces.some((ns) => ns.startsWith("kadence"));
  const detectedPreset = hasKadencePro ? "kadence-pro" : hasKadence ? "kadence" : "none";

  // 4. Detect plugins from namespaces
  const seen = new Set();
  const detectedPlugins = [];
  for (const ns of namespaces) {
    const info = NAMESPACE_TO_PLUGIN[ns];
    if (!info) continue;
    if (seen.has(info.slug)) continue;
    seen.add(info.slug);
    detectedPlugins.push({
      slug: info.slug,
      name: info.name,
      detectedFrom: `REST namespace: ${ns}`,
      effort: info.effort || "medium",
      replacement: PLUGIN_REPLACEMENTS[info.slug] || "Ei automaattista korvausehdotusta — arvioi erikseen.",
    });
  }

  // 5. Taxonomy detection
  let taxonomies = [];
  try {
    const taxData = await fetchJson(`${wpBaseUrl}/wp-json/wp/v2/taxonomies`, headers);
    taxonomies = Object.keys(taxData);
  } catch { /* ignore */ }

  // 6. Menu count (best-effort)
  let menuCount = 0;
  try {
    const menuResp = await fetch(`${wpBaseUrl}/wp-json/wp/v2/menus`, { headers });
    if (menuResp.ok) {
      const menus = await menuResp.json();
      menuCount = Array.isArray(menus) ? menus.length : 0;
    }
  } catch { /* ignore */ }

  // 7. Build suggested config
  const nonDefaultTypes = Object.keys(contentInventory).filter(
    (s) => !["post", "page", "attachment", "nav_menu_item", "wp_block", "wp_template", "wp_template_part", "wp_navigation", "wp_global_styles", "wp_font_face", "wp_font_family"].includes(s) && contentInventory[s].count > 0
  );
  const contentTypes = ["posts", "pages", ...nonDefaultTypes.map((s) => contentInventory[s]?.restBase || s)].join(",");

  const suggestedConfig = {
    wpBaseUrl,
    restNamespace: "/wp-json/wp/v2",
    contentTypes,
    preset: detectedPreset,
    htmlMode: "keep-html",
    authMode,
    wpUser: raw.wpUser || "",
    wpAppPassword: raw.wpAppPassword || "",
    wpBearerToken: raw.wpBearerToken || "",
    downloadMedia: false,
    createRedirects: true,
    importMenus: true,
    dryRun: true,
    useNunjucksLayouts: detectedPreset !== "none",
    convertKadenceBlocks: hasKadence,
    migrateStyles: hasKadence,
  };

  // 8. Plain-language report lines
  const totalItems = Object.values(contentInventory).reduce((s, t) => s + t.count, 0);
  const contentLines = Object.entries(contentInventory)
    .filter(([, t]) => t.count > 0)
    .map(([, t]) => `  • ${t.label}: ${t.count} kpl`);
  const pluginLines = detectedPlugins.length
    ? detectedPlugins.map((p) => `  • ${p.name} (${p.effort === "high" ? "korkea" : p.effort === "medium" ? "kohtalainen" : "matala"} työmäärä)`)
    : ["  • Ei tunnistettuja lisäosia REST API:n perusteella"];

  const report = [
    `Sivusto: ${siteInfo.title} (${siteInfo.url})`,
    siteInfo.description ? `Kuvaus: ${siteInfo.description}` : null,
    "",
    `Sisältö (${totalItems} kohdetta yhteensä):`,
    ...contentLines,
    contentLines.length === 0 ? "  • Julkaistua sisältöä ei löydy tai REST API vaatii kirjautumisen." : null,
    "",
    `Havaittu teema/preset: ${detectedPreset === "none" ? "Ei tunnistettu (käytetään oletuksia)" : detectedPreset}`,
    `Valikot: ${menuCount > 0 ? `${menuCount} kpl löydetty` : "Ei löydetty REST API:sta (tuodaan HTML-fallbackilla)"}`,
    `Taksonomiit: ${taxonomies.join(", ") || "ei havaittu"}`,
    "",
    `Havaitut lisäosat (${detectedPlugins.length} kpl):`,
    ...pluginLines,
    "",
    warnings.length ? `Huomiot:\n${warnings.map((w) => `  ! ${w}`).join("\n")}` : null,
    "",
    "Ehdotettu seuraava askel:",
    "  1. Tarkista ehdotettu konfiguraatio alla.",
    "  2. Käytä 'Täytä lomake analyysin perusteella' -painiketta.",
    "  3. Aja ensin dry-run.",
  ].filter((l) => l !== null).join("\n");

  return {
    ok: true,
    siteInfo,
    namespaces,
    contentInventory,
    detectedPreset,
    detectedPlugins,
    taxonomies,
    menuCount,
    suggestedConfig,
    report,
    warnings,
  };
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

      if (req.method === "POST" && url.pathname === "/api/wp-analyze") {
        const body = await readJsonBody(req);
        try {
          const result = await analyzeWordPressSite(body);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 500, { error: String(err?.message || err) });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/defaults") {
        const stamp = nowStamp();
        const outputRoot = `./migrations/wp-to-eleventy-${stamp}`;
        sendJson(res, 200, {
          siteMode: "new",
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

      if (req.method === "POST" && url.pathname === "/api/pick-folder") {
        try {
          const body = await readJsonBody(req);
          const folderPath = await pickFolderPath(body.initialPath);
          sendJson(res, 200, { ok: true, folderPath });
        } catch (err) {
          if (err?.code === "ABORT_ERR") {
            sendJson(res, 200, { ok: false, cancelled: true });
            return;
          }
          sendJson(res, 500, { error: String(err?.message || err) });
        }
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

      if (req.method === "POST" && url.pathname === "/api/analyze") {
        const body = await readJsonBody(req);
        const config = await createConfigFromInput(body);
        const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const log = [];
        const progress = (level, msg) => {
          log.push({ level, msg, t: new Date().toISOString() });
        };
        jobs.set(jobId, { status: "running", kind: "analysis", log });
        analyzeSite(config, progress).then((report) => {
          writeSiteProfileArtifacts(config.outputRoot, report.siteProfile, progress).then((artifacts) => {
            if (artifacts.profilePath) report.profilePath = artifacts.profilePath;
            if (artifacts.summaryPath) report.profileSummaryPath = artifacts.summaryPath;
            if (artifacts.configureSummary) report.configure = artifacts.configureSummary;
            jobs.set(jobId, { status: "done", kind: "analysis", report, log });
          }).catch((artifactErr) => {
            log.push({
              level: "warn",
              msg: `DISCOVER: profiilin tallennus epäonnistui: ${String(artifactErr?.message || artifactErr)}`,
              t: new Date().toISOString()
            });
            jobs.set(jobId, { status: "done", kind: "analysis", report, log });
          });
        }).catch((err) => {
          jobs.set(jobId, { status: "error", kind: "analysis", error: String(err?.message || err), detail: String(err?.stack || err), log });
        });
        sendJson(res, 202, { ok: true, jobId });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/run/")) {
        const jobId = url.pathname.slice("/api/run/".length);
        const job = jobs.get(jobId);
        if (!job) { sendJson(res, 404, { error: "Job not found" }); return; }
        sendJson(res, 200, job);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/analyze/")) {
        const jobId = url.pathname.slice("/api/analyze/".length);
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
