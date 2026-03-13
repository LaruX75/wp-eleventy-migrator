#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_TYPES = ["posts", "pages"];
const DEFAULT_NAMESPACE = "/wp-json/wp/v2";

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

function extractMediaUrls(html, wpBaseUrl) {
  const urls = new Set();
  const srcMatches = String(html || "").matchAll(/\bsrc=["']([^"']+)["']/gi);
  for (const m of srcMatches) {
    const u = m[1];
    if (!u) continue;
    if (u.startsWith("http://") || u.startsWith("https://")) {
      if (!wpBaseUrl || u.startsWith(wpBaseUrl)) urls.add(u);
    }
  }
  return [...urls];
}

function sanitizeFileSegment(v) {
  return String(v || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function downloadFile(url, outPath, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed media download: ${res.status} ${url}`);
  const arr = new Uint8Array(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, arr);
}

function buildTargetPermalink(type, slug, config) {
  if (type === "pages") return `/${slug}/`;
  const tpl = config.targetPermalinkPattern || "/{type}/{slug}/";
  return tpl.replaceAll("{type}", slugify(type)).replaceAll("{slug}", slugify(slug));
}

function itemToDoc(item, type, config, categoryMap, tagMap) {
  const title = decodeHtml(item?.title?.rendered || item?.title || `Untitled ${item?.id || ""}`.trim());
  const slug = slugify(item?.slug || title);
  const excerpt = stripHtml(item?.excerpt?.rendered || item?.excerpt || "");
  const categories = Array.isArray(item?.categories) ? item.categories.map((id) => categoryMap.get(id)).filter(Boolean) : [];
  const tags = Array.isArray(item?.tags) ? item.tags.map((id) => tagMap.get(id)).filter(Boolean) : [];
  const rawHtml = item?.content?.rendered || item?.content || "";
  const body = config.htmlMode === "basic-markdown" ? basicHtmlToMarkdown(rawHtml) : rawHtml.trim();
  const permalink = buildTargetPermalink(type, slug, config);

  return {
    title,
    slug,
    permalink,
    frontMatter: {
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
    },
    body
  };
}

async function runMigration(configPath, explicitConfig) {
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

  const root = path.resolve(process.cwd(), config.outputRoot);
  const contentRoot = path.join(root, config.contentDir);
  const mediaRoot = path.join(root, config.mediaDir);
  await fs.mkdir(contentRoot, { recursive: true });
  if (config.downloadMedia) await fs.mkdir(mediaRoot, { recursive: true });

  const headers = {};
  if (config.authMode === "app-password" && config.wpUser && config.wpAppPassword) {
    const token = Buffer.from(`${config.wpUser}:${config.wpAppPassword}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  } else if (config.authMode === "bearer" && config.wpBearerToken) {
    headers.Authorization = `Bearer ${config.wpBearerToken}`;
  }

  const baseApi = joinUrl(config.wpBaseUrl, config.restNamespace || DEFAULT_NAMESPACE);
  printStep("fetch", `Taxonomies from ${baseApi}`);
  const [cats, tags] = await Promise.all([
    fetchAllPages(`${baseApi}/categories`, headers).catch(() => []),
    fetchAllPages(`${baseApi}/tags`, headers).catch(() => [])
  ]);
  const categoryMap = new Map(cats.map((c) => [c.id, c.name]));
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));

  for (const type of config.contentTypes) {
    const typeSlug = slugify(type);
    const endpoint = `${baseApi}/${typeSlug}`;
    printStep("fetch", `${type} -> ${endpoint}`);
    let items = await fetchAllPages(endpoint, headers);
    if (!config.includeDrafts) items = items.filter((i) => i?.status === "publish");

    const outTypeDir = path.join(contentRoot, typeSlug);
    await fs.mkdir(outTypeDir, { recursive: true });

    let written = 0;
    for (const item of items) {
      const doc = itemToDoc(item, typeSlug, config, categoryMap, tagMap);
      const datePart = typeSlug === "posts" ? `${toIsoDay(item?.date)}-` : "";
      const fileName = `${datePart}${doc.slug}.md`;
      const filePath = path.join(outTypeDir, fileName);
      const frontMatter = toFrontMatter(doc.frontMatter);
      const content = `${frontMatter}\n${doc.body}\n`;
      if (!config.dryRun) await fs.writeFile(filePath, content, "utf8");
      written += 1;

      if (config.createRedirects && item?.link) report.redirects.push({ from: item.link, to: doc.permalink });

      if (config.downloadMedia && !config.dryRun) {
        const mediaUrls = extractMediaUrls(item?.content?.rendered || "", ensureTrailingSlash(config.wpBaseUrl));
        for (const mediaUrl of mediaUrls) {
          try {
            const urlObj = new URL(mediaUrl);
            const relPath = urlObj.pathname.replace(/^\/+/, "");
            const outPath = path.join(mediaRoot, sanitizeFileSegment(relPath));
            if (!(await fileExists(outPath))) await downloadFile(mediaUrl, outPath, headers);
          } catch (err) {
            report.warnings.push(`Media failed for ${item?.id || "?"}: ${String(err.message || err)}`);
          }
        }
      }
    }
    report.totals[typeSlug] = written;
  }

  if (config.createRedirects) {
    const redirectsPath = path.join(root, "redirects.csv");
    const csv = ["from,to", ...report.redirects.map((r) => `${JSON.stringify(r.from)},${JSON.stringify(r.to)}`)].join("\n");
    if (!config.dryRun) await fs.writeFile(redirectsPath, `${csv}\n`, "utf8");
    report.redirectsPath = redirectsPath;
  }

  report.finishedAt = new Date().toISOString();
  report.outputRoot = root;
  report.reportPath = path.join(root, "migration-report.json");
  if (!config.dryRun) await fs.writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function runWizard() {
  const rl = readline.createInterface({ input, output });
  try {
    output.write("\nWordPress -> Eleventy Migration Wizard\n");
    output.write("This wizard asks required migration choices and can run migration immediately.\n");

    const sourceType = (await ask(rl, "Source type (rest/xml/json)", "rest")).toLowerCase();
    const wpBaseUrl = await ask(rl, "WordPress base URL (e.g. https://example.com)", "");
    const restNamespace = await ask(rl, "REST namespace path", DEFAULT_NAMESPACE);
    const contentTypes = parseCsvList(await ask(rl, "Content types (comma-separated)", DEFAULT_TYPES.join(",")));
    const includeDrafts = await askYesNo(rl, "Include drafts and private posts", false);
    const downloadMedia = await askYesNo(rl, "Download media files locally", false);
    const createRedirects = await askYesNo(rl, "Generate redirects CSV", true);
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
    const stamp = nowStamp();
    const outputRoot = await ask(rl, "Output root", `./migrations/wp-to-eleventy-${stamp}`);
    const contentDir = await ask(rl, "Content subdirectory", "content");
    const mediaDir = await ask(rl, "Media subdirectory", "media");
    const configPath = await ask(rl, "Config file path", path.join(outputRoot, "migration-config.json"));

    const config = {
      sourceType,
      wpBaseUrl: wpBaseUrl.replace(/\/+$/, ""),
      restNamespace,
      contentTypes: contentTypes.length ? contentTypes : [...DEFAULT_TYPES],
      includeDrafts,
      downloadMedia,
      createRedirects,
      htmlMode: htmlMode === "basic-markdown" ? "basic-markdown" : "keep-html",
      targetPermalinkPattern,
      authMode: ["none", "app-password", "bearer"].includes(authMode) ? authMode : "none",
      wpUser,
      wpAppPassword,
      wpBearerToken,
      dryRun,
      outputRoot,
      contentDir,
      mediaDir
    };

    await fs.mkdir(path.dirname(path.resolve(process.cwd(), configPath)), { recursive: true });
    await fs.writeFile(path.resolve(process.cwd(), configPath), `${JSON.stringify(config, null, 2)}\n`, "utf8");
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
  output.write("Usage:\n");
  output.write("  node scripts/wp-eleventy-migrate.mjs wizard\n");
  output.write("  node scripts/wp-eleventy-migrate.mjs run <config.json>\n");
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
