import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

import { createConfigFromInput, nowStamp } from "../config/normalize.mjs";
import { redactConfig } from "../config/redact.mjs";

// Analyze-only preflight. This module is strictly an orchestrator: it
// composes the read-only primitives already exposed by the legacy engine
// (REST fetch, auth headers, block parsing, media URL extraction, slug
// and permalink generation, language detection) and turns the results
// into a migration report + write plan. It never writes into an
// Eleventy project, downloads media, installs dependencies, or mutates
// WordPress in any way.
//
// The only outputs are two JSON files inside a dedicated analysis
// output directory:
//   - migration-report.json  (execution summary, capability findings)
//   - write-plan.json        (deterministic plan derived from the source)
//
// Engine access is deferred to a dynamic import inside runAnalyze() so
// this module does not create a top-level src → engine → src cycle,
// following the same discipline PR 1 established.

const REPORT_FILE = "migration-report.json";
const WRITE_PLAN_FILE = "write-plan.json";

const WXR_HINTS = [
  "<?xml",
  "wp:wxr_version",
  "xmlns:wp=",
  "xmlns:content=",
  "xmlns:excerpt="
];

async function verifyXmlBackup(configXmlPath, configDir) {
  const absolute = path.isAbsolute(configXmlPath)
    ? configXmlPath
    : path.resolve(configDir, configXmlPath);

  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`XML backup not found: ${absolute}`);
    }
    throw new Error(`XML backup could not be read: ${absolute} (${err.message || err})`);
  }
  if (!stat.isFile()) {
    throw new Error(`XML backup is not a regular file: ${absolute}`);
  }
  if (stat.size === 0) {
    throw new Error(`XML backup is empty: ${absolute}`);
  }

  // Read a bounded prefix + hash the whole file. The prefix is enough to
  // sanity-check the format; the hash captures the full content so the
  // report is auditable.
  const fh = await fs.open(absolute, "r");
  let prefixText = "";
  try {
    const prefixLen = Math.min(stat.size, 4096);
    const buf = Buffer.alloc(prefixLen);
    await fh.read(buf, 0, prefixLen, 0);
    prefixText = buf.toString("utf8");
  } finally {
    await fh.close();
  }

  const looksLikeWxr = WXR_HINTS.filter((needle) => prefixText.includes(needle)).length >= 2;
  if (!looksLikeWxr) {
    throw new Error(
      `XML backup does not look like a WordPress WXR export: ${absolute}. ` +
        `Expected markers such as "<?xml", "wp:wxr_version" or "xmlns:wp=".`
    );
  }

  const hash = crypto.createHash("sha256");
  const contents = await fs.readFile(absolute);
  hash.update(contents);

  return {
    status: "verified",
    filename: absolute,
    sizeBytes: stat.size,
    sha256: hash.digest("hex"),
    verifiedAt: new Date().toISOString()
  };
}

function skippedXmlBackup() {
  return {
    status: "skipped",
    skippedAt: new Date().toISOString(),
    warning:
      "XML/WXR backup preflight was bypassed with --skip-xml-backup. " +
      "This is a deliberate override; a real migration must still start from a verified WXR export."
  };
}

async function fetchTaxonomy(engine, baseApi, name, headers, warnings) {
  try {
    const items = await engine.fetchAllPages(`${baseApi}/${name}`, headers);
    return Array.isArray(items) ? items : [];
  } catch (err) {
    warnings.push(`Taxonomy ${name}: fetch failed (${err.message || err})`);
    return [];
  }
}

async function fetchContentItems(engine, baseApi, type, headers, warnings, authMode) {
  const embedded = `${baseApi}/${type}?_embed=1`;
  const editUrl = authMode !== "none" ? `${baseApi}/${type}?context=edit&_embed=1` : null;
  try {
    if (editUrl) {
      try {
        return { items: await engine.fetchAllPages(editUrl, headers), context: "edit" };
      } catch (err) {
        warnings.push(`Content ${type}: context=edit unavailable (${err.message || err}); retrying public fetch`);
      }
    }
    return { items: await engine.fetchAllPages(embedded, headers), context: "public" };
  } catch (err) {
    warnings.push(`Content ${type}: fetch failed (${err.message || err})`);
    return { items: [], context: "failed" };
  }
}

function computeSlug(engine, item) {
  const rawSlug = String(item?.slug || "").trim();
  if (rawSlug) return engine.slugify(rawSlug);
  const rawTitle = String(item?.title?.rendered || "").trim();
  return engine.slugify(rawTitle) || `entry-${item?.id ?? "unknown"}`;
}

function toIsoDay(dateStr) {
  const d = new Date(String(dateStr || ""));
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function planDocument(engine, item, type, config) {
  const slug = computeSlug(engine, item);
  const targetPermalink = engine.buildTargetPermalink(type, slug, config, item?.link || "");
  const datePart = type === "posts" && item?.date ? `${toIsoDay(item.date)}-` : "";
  const targetPath = `${config.contentDir}/${type}/${datePart}${slug}.md`;

  return {
    sourceId: item?.id ?? null,
    sourceUrl: item?.link || "",
    type,
    slug,
    targetPath,
    targetPermalink
  };
}

function analyzeBlocks(engine, content, aggregate) {
  const raw = typeof content === "string" ? content : String(content?.raw || content?.rendered || "");
  if (!raw) return;
  const nodes = engine.parseWpBlocks(raw);
  engine.collectBlockProfile(nodes, aggregate);
}

function classifyBlocks(engine, blocksUsed) {
  const gutenberg = [];
  const kadence = [];
  const kadenceUnknown = [];
  const kadenceSupported = new Set([
    ...engine.SUPPORTED_KADENCE_BLOCKS.map((name) => `kadence/${name}`),
    ...engine.SUPPORTED_KADENCE_PRO_BLOCKS.map((name) => `kadence/${name}`)
  ]);
  for (const [name, count] of Object.entries(blocksUsed || {})) {
    if (name.startsWith("kadence/")) {
      if (kadenceSupported.has(name)) kadence.push({ name, count });
      else kadenceUnknown.push({ name, count });
    } else {
      gutenberg.push({ name, count });
    }
  }
  const sortByCountDesc = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  gutenberg.sort(sortByCountDesc);
  kadence.sort(sortByCountDesc);
  kadenceUnknown.sort(sortByCountDesc);
  return { gutenberg, kadence, kadenceUnknown };
}

async function detectTranslations(engine, wpBaseUrl, headers, warnings) {
  try {
    const langs = await engine.detectLanguages(wpBaseUrl, headers);
    if (!Array.isArray(langs) || langs.length < 2) {
      return { status: "single-language", languages: Array.isArray(langs) ? langs : [] };
    }
    // The engine currently detects languages but does not resolve per-post
    // translation relations. Architecture-v2-01 §3.5 mandates an adapter
    // that returns a translations map; until that exists, mark unresolved.
    warnings.push(
      "translations: unresolved — WPML/Polylang languages detected but per-post relation adapter is not implemented yet."
    );
    return { status: "unresolved", languages: langs };
  } catch (err) {
    warnings.push(`Language detection failed: ${err.message || err}`);
    return { status: "unavailable", languages: [] };
  }
}

async function ensureOutputDir(config, configDir) {
  const requested = config.analysisOutputDir;
  if (requested) {
    const absolute = path.isAbsolute(requested) ? requested : path.resolve(configDir, requested);
    await fs.mkdir(absolute, { recursive: true });
    return absolute;
  }
  const stamp = nowStamp();
  const fallback = path.resolve(process.cwd(), "analyses", `wp-analysis-${stamp}`);
  await fs.mkdir(fallback, { recursive: true });
  return fallback;
}

function summarizeCapability(res) {
  return {
    contextEditRequested: res.context === "edit" || res.context === "public",
    contextEditGranted: res.context === "edit",
    contextEditNote:
      res.context === "edit"
        ? "context=edit was accepted. Note: this may surface metadata such as Yoast fields to the authenticated user but does not guarantee complete Yoast meta visibility."
        : res.context === "public"
        ? "context=edit was not used (auth mode 'none' or endpoint returned unauthorised); falling back to public REST view."
        : "content fetch failed; capability cannot be inferred."
  };
}

/**
 * Run analyze-only preflight against a WordPress source.
 *
 * Reads configPath, verifies (or, with { skipXmlBackup: true }, records
 * a skip of) an XML/WXR backup, performs read-only REST queries, and
 * writes migration-report.json + write-plan.json into the analysis
 * output directory. Returns the paths of the written artefacts.
 *
 * Never writes anything else — no content, no media, no Eleventy
 * scaffolding, no dependency installs.
 */
export async function runAnalyze(configPath, opts = {}) {
  const skipXmlBackup = Boolean(opts.skipXmlBackup);
  const absoluteConfigPath = path.resolve(process.cwd(), configPath);
  const configDir = path.dirname(absoluteConfigPath);
  const rawConfig = JSON.parse(await fs.readFile(absoluteConfigPath, "utf8"));
  const config = await createConfigFromInput(rawConfig);

  const startedAt = new Date().toISOString();
  const warnings = [];

  // 1. XML/WXR preflight gate. If neither a verified backup nor an
  //    explicit CLI skip is present, we refuse to touch the source.
  let xmlBackup;
  if (skipXmlBackup) {
    xmlBackup = skippedXmlBackup();
    warnings.push(xmlBackup.warning);
  } else {
    if (!config.xmlBackupPath) {
      throw new Error(
        "xmlBackupPath is required in the config. Provide a local WordPress WXR export path, or re-run with --skip-xml-backup (documented as dangerous)."
      );
    }
    xmlBackup = await verifyXmlBackup(config.xmlBackupPath, configDir);
  }

  const outputDir = await ensureOutputDir(config, configDir);

  // 2. Auth + capability sniff (engine.buildAuthHeaders reused).
  const engine = await import("../../scripts/wp-eleventy-migrate.mjs");
  const headers = engine.buildAuthHeaders(config);
  const authSummary = {
    mode: config.authMode,
    hasCredentials:
      (config.authMode === "app-password" && Boolean(config.wpUser && config.wpAppPassword)) ||
      (config.authMode === "bearer" && Boolean(config.wpBearerToken))
  };

  // 3. REST discovery.
  const baseApi = engine.joinUrl(config.wpBaseUrl, config.restNamespace);

  const [categories, tags] = await Promise.all([
    fetchTaxonomy(engine, baseApi, "categories", headers, warnings),
    fetchTaxonomy(engine, baseApi, "tags", headers, warnings)
  ]);

  const taxonomies = [
    { type: "category", count: categories.length },
    { type: "post_tag", count: tags.length }
  ];

  // 4. Content types (posts/pages/…). We only ever read — no writes.
  const contentTypes = [];
  const documents = [];
  const blocksUsed = { blocksUsed: {}, separatorsUsed: new Set(), colLayouts: new Set(), heroPages: new Set(), headingColors: new Set(), headingSizes: new Set(), buttonStyles: new Set() };
  const mediaUrls = new Set();
  let contextEditGranted = false;

  for (const type of config.contentTypes) {
    const res = await fetchContentItems(engine, baseApi, type, headers, warnings, config.authMode);
    contentTypes.push({
      type,
      count: res.items.length,
      capability: summarizeCapability(res)
    });
    if (res.context === "edit") contextEditGranted = true;

    for (const item of res.items) {
      documents.push(planDocument(engine, item, type, config));
      const rawContent = item?.content?.raw || item?.content?.rendered || "";
      analyzeBlocks(engine, rawContent, blocksUsed);
      const urls = engine.extractMediaUrls(rawContent, engine.ensureTrailingSlash(config.wpBaseUrl));
      for (const url of urls) mediaUrls.add(url);
    }
  }

  // 5. Translations relation.
  const translations = await detectTranslations(engine, config.wpBaseUrl, headers, warnings);

  // 6. Assemble outputs.
  const blockClassification = classifyBlocks(engine, blocksUsed.blocksUsed);

  const writePlan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    contentTypes,
    taxonomies,
    translations,
    blocks: blockClassification,
    documents,
    media: {
      urlCount: mediaUrls.size,
      warning:
        mediaUrls.size > 0
          ? `${mediaUrls.size} media URLs referenced by content. Analyze mode does not download them; enable downloadMedia during the real migration.`
          : "No media URLs detected in scanned content."
    },
    warnings
  };

  const report = {
    schemaVersion: 1,
    mode: "analyze-only",
    startedAt,
    finishedAt: new Date().toISOString(),
    configPath: absoluteConfigPath,
    wpBaseUrl: config.wpBaseUrl,
    sourceType: config.sourceType,
    xmlBackup,
    auth: authSummary,
    capability: {
      contextEditGranted,
      contextEditNote: contextEditGranted
        ? "At least one content type accepted context=edit. This may surface metadata such as Yoast fields to the authenticated user but does not guarantee complete Yoast meta visibility."
        : "context=edit was not granted or not attempted; the report reflects the public REST view only."
    },
    totals: {
      contentTypes: contentTypes.length,
      documents: documents.length,
      taxonomies: taxonomies.length,
      mediaUrls: mediaUrls.size,
      blocksGutenberg: blockClassification.gutenberg.length,
      blocksKadence: blockClassification.kadence.length,
      blocksKadenceUnknown: blockClassification.kadenceUnknown.length,
      warnings: warnings.length
    },
    warnings,
    effectiveConfig: redactConfig(config),
    outputDir
  };

  const reportPath = path.join(outputDir, REPORT_FILE);
  const writePlanPath = path.join(outputDir, WRITE_PLAN_FILE);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(writePlanPath, `${JSON.stringify(writePlan, null, 2)}\n`, "utf8");

  return { reportPath, writePlanPath, outputDir };
}
