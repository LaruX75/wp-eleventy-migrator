import readline from "node:readline/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import process from "node:process";

import {
  DEFAULT_NAMESPACE,
  DEFAULT_TYPES,
  DEFAULT_KADENCE_BLOCKS_DIR,
  DEFAULT_KADENCE_STYLES_DIR,
  DEFAULT_KADENCE_PRO_STYLES_DIR,
  DEFAULT_STYLES_DIR,
  DEFAULT_DATA_DIR
} from "../config/defaults.mjs";
import {
  nowStamp,
  parseCsvList,
  createConfigFromInput
} from "../config/normalize.mjs";
import { ask, askYesNo } from "./prompt.mjs";

// Engine import is deferred to runWizard() to avoid an initialisation-time
// cycle when scripts/wp-eleventy-migrate.mjs is invoked directly and forwards
// to src/main.mjs.

export async function runWizard() {
  const {
    saveConfig,
    runMigration,
    detectLanguages,
    runMultilingualPasses
  } = await import("../../scripts/wp-eleventy-migrate.mjs");

  const rl = readline.createInterface({ input, output });
  try {
    output.write("\nWordPress -> Eleventy Migration Wizard\n");
    output.write("This wizard asks required migration choices and can run migration immediately.\n");

    const sourceType = (await ask(rl, "Source type (only 'rest' is currently supported)", "rest")).toLowerCase();
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

    let detectedLangs = [];
    if (wpBaseUrl && sourceType === "rest") {
      const authHeaders = {};
      if (authMode === "app-password" && wpUser && wpAppPassword) {
        authHeaders.Authorization = `Basic ${Buffer.from(`${wpUser}:${wpAppPassword}`).toString("base64")}`;
      } else if (authMode === "bearer" && wpBearerToken) {
        authHeaders.Authorization = `Bearer ${wpBearerToken}`;
      }
      detectedLangs = await detectLanguages(wpBaseUrl, authHeaders);
      if (detectedLangs.length > 1) {
        output.write(`\nDetected ${detectedLangs.length} languages: ${detectedLangs.map(l => `${l.code} (${l.name})`).join(", ")}\n`);
        output.write("The main language will be migrated normally. Other languages will be offered afterwards.\n");
      }
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

    if (detectedLangs.length > 1 && !config.lang) {
      const mainLang = detectedLangs[0].code;
      const extraLangs = detectedLangs.filter(l => l.code !== mainLang);
      output.write("\nAdditional languages detected. You can migrate them now.\n");
      await runMultilingualPasses(config, extraLangs, rl);
    }
  } finally {
    rl.close();
  }
}
