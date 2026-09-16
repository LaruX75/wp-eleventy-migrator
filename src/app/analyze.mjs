import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

import { createConfigFromInput, nowStamp } from "../config/normalize.mjs";
import { redactConfig } from "../config/redact.mjs";
import {
  parseShortcodes,
  countShortcodes,
  collectUnhandled
} from "../blocks/shortcode-parser.mjs";

// Engine fallback criticality tables (arch-v2-02 §3 + §5). No
// transformer is registered yet, so every recognised shortcode/block
// currently falls back to these classifications. Later transformer
// PRs will move names from these lists into transformer-owned
// handling.
const KNOWN_BLOCKING = new Set([
  // Runtime widgets and dynamic listings that will not render without
  // a target-side replacement.
  "rev_slider",
  "revslider",
  "contact-form-7",
  "wpforms",
  "gravityform",
  "gravityforms",
  "vcex_blog_grid",
  "vcex_post_type_grid",
  "latest-posts",
  "recent-posts",
  "instagram-feed",
  "wdi_instagram_feed",
  "pdf-embedder"
]);

const KNOWN_INFORMATIONAL = new Set([
  // Decorative or spacing-only shortcodes; the target-side impact is
  // cosmetic and safely preserved as raw content. Note: WPBakery
  // leaf shortcodes (`vc_empty_space`, `vc_custom_heading`,
  // `vc_single_image`, `vc_video`) are deliberately NOT in this set.
  // They surface authoritative content (headings, media, video) whose
  // migration decision requires a human review, not a decorative pass.
  "nbsp",
  "br"
]);

// Shortcodes that WordPress parses as implicitly self-closing — they
// carry a single opening tag without a matching `[/name]`. Without
// this hint the generic shortcode parser (arch-v2-02 §1) would
// classify them as `malformed-shortcode`, which is the wrong
// diagnosis: the source is syntactically valid, not broken.
//
// The list is deliberately small and only names the WPBakery leaves
// observed in real WordPress content. Transformer PRs (arch-v2-02
// §9 vaihe 2 onwards) will move handling of these names out of the
// fallback tables and into the WPBakery page-builder transformer.
const IMPLICIT_SELF_CLOSING = new Set([
  "vc_empty_space",
  "vc_custom_heading",
  "vc_single_image",
  "vc_video"
]);

function classifyCriticality(unitName) {
  if (KNOWN_BLOCKING.has(unitName)) return "blocking";
  if (KNOWN_INFORMATIONAL.has(unitName)) return "informational";
  return "manual-review";
}

// Reasons emitted alongside criticality so the report is
// self-explaining without cross-referencing this module.
function reasonForShortcode(unitName, criticality) {
  if (criticality === "blocking") {
    return "Runtime or dynamic shortcode; the target site cannot render it without an explicit replacement.";
  }
  if (criticality === "informational") {
    return "Decorative shortcode; preserved verbatim in output. Cosmetic-only impact.";
  }
  return "Shortcode is not recognised by any configured transformer; source unit preserved for manual review.";
}

function reasonForParserUnhandled(kind) {
  if (kind === "escaped-shortcode") {
    return "Escaped shortcode syntax detected. WordPress renders it as literal text; preserved verbatim.";
  }
  if (kind === "malformed-shortcode") {
    return "Malformed shortcode syntax detected (missing bracket or closer). Source unit preserved for manual review.";
  }
  return "Unhandled source unit; preserved verbatim.";
}

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

// Compute overallStatus per arch-v2-02 §4. Priority: blocking >
// manual-review > partial > complete. `partial` covers documents
// with only informational warnings or preserved source units.
function computeOverallStatus(unhandledUnits, preservedSourceUnits) {
  let hasBlocking = false;
  let hasManualReview = false;
  let hasInformational = false;
  for (const u of unhandledUnits) {
    if (u.criticality === "blocking") hasBlocking = true;
    else if (u.criticality === "manual-review") hasManualReview = true;
    else if (u.criticality === "informational") hasInformational = true;
  }
  if (hasBlocking) return "blocked";
  if (hasManualReview) return "manual-review";
  if (hasInformational || (preservedSourceUnits && preservedSourceUnits.length > 0)) {
    return "partial";
  }
  return "complete";
}

// Build the per-document transformerPlan block (arch-v2-02 §4).
// No transformer is registered in this PR, so `handledUnits` is
// always empty and every recognised shortcode becomes an
// unhandledUnit classified by the engine fallback tables.
function buildTransformerPlan(shortcodeNodes) {
  const shortcodeCounts = countShortcodes(shortcodeNodes);
  const parserUnhandled = collectUnhandled(shortcodeNodes);

  const unhandledMap = new Map(); // key = unit → aggregate
  const push = (unit, criticality, reason) => {
    const key = `${unit}::${criticality}`;
    const existing = unhandledMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      unhandledMap.set(key, { unit, count: 1, criticality, reason });
    }
  };

  for (const [name, count] of Object.entries(shortcodeCounts)) {
    const crit = classifyCriticality(name);
    const reason = reasonForShortcode(name, crit);
    for (let i = 0; i < count; i += 1) push(name, crit, reason);
  }
  for (const u of parserUnhandled) {
    push(u.kind, "manual-review", u.reason || reasonForParserUnhandled(u.kind));
  }

  const unhandledUnits = [...unhandledMap.values()].sort(
    (a, b) => b.count - a.count || a.unit.localeCompare(b.unit)
  );

  // Preserved source units: any shortcode top-level structural unit
  // whose original text remains verbatim in the doc body (no
  // transformer touched it). In this PR that is *every* recognised
  // shortcode, since no transformer is registered — we surface only
  // aggregate counts + bytes, not the text itself.
  const preservedSourceUnits = [];
  const walkPreserved = (nodes) => {
    for (const node of nodes || []) {
      if (node.type === "shortcode") {
        preservedSourceUnits.push({
          unit: node.name,
          bytes: node.end - node.start
        });
        if (node.children) walkPreserved(node.children);
      }
    }
  };
  walkPreserved(shortcodeNodes);
  // Aggregate preserved into {unit, count, bytes}.
  const preservedAgg = new Map();
  for (const p of preservedSourceUnits) {
    const cur = preservedAgg.get(p.unit) || { unit: p.unit, count: 0, bytes: 0 };
    cur.count += 1;
    cur.bytes += p.bytes;
    preservedAgg.set(p.unit, cur);
  }
  const preserved = [...preservedAgg.values()].sort(
    (a, b) => b.count - a.count || a.unit.localeCompare(b.unit)
  );

  return {
    handledUnits: [],
    unhandledUnits,
    preservedSourceUnits: preserved,
    overallStatus: computeOverallStatus(unhandledUnits, preserved)
  };
}

// Per-document shortcode name→count for `documents[].shortcodes` (§1).
function summariseShortcodes(shortcodeNodes) {
  const counts = countShortcodes(shortcodeNodes);
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
      const doc = planDocument(engine, item, type, config);
      const rawContent = item?.content?.raw || item?.content?.rendered || "";
      analyzeBlocks(engine, rawContent, blocksUsed);
      const shortcodeNodes = parseShortcodes(rawContent, {
        selfClosingNames: IMPLICIT_SELF_CLOSING
      });
      doc.shortcodes = summariseShortcodes(shortcodeNodes);
      doc.transformerPlan = buildTransformerPlan(shortcodeNodes);
      documents.push(doc);
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
      shortcodes: documents.reduce((sum, d) => sum + (d.shortcodes || []).reduce((s, x) => s + x.count, 0), 0),
      documentsByStatus: documents.reduce((acc, d) => {
        const s = d.transformerPlan?.overallStatus || "complete";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {}),
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
