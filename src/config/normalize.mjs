import path from "node:path";

import {
  DEFAULT_TYPES,
  DEFAULT_NAMESPACE,
  DEFAULT_DATA_DIR,
  DEFAULT_KADENCE_BLOCKS_DIR,
  DEFAULT_STYLES_DIR,
  DEFAULT_KADENCE_STYLES_DIR,
  DEFAULT_KADENCE_PRO_STYLES_DIR
} from "./defaults.mjs";

export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function parseCsvList(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function normalizeEleventyReplacements(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => ({
    slug: String(item?.slug || "").trim(),
    wordpressPlugin: String(item?.wordpressPlugin || "").trim(),
    eleventySolution: String(item?.eleventySolution || "").trim(),
    packageName: String(item?.packageName || "").trim(),
    enabled: Boolean(item?.enabled ?? true)
  })).filter((item) => item.slug && item.wordpressPlugin && item.eleventySolution);
}

export function resolveOutputRoot(rawOutputRoot, localProjectFolder, stamp = nowStamp()) {
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

export async function createConfigFromInput(raw = {}) {
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
    docLayout: String(raw.docLayout || "").trim(),
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
