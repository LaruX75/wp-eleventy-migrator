import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process, { stdout as output } from "node:process";

import { createConfigFromInput } from "../config/normalize.mjs";

// Engine import is deferred to runFromConfig() to avoid an initialisation-time
// cycle when scripts/wp-eleventy-migrate.mjs is invoked directly and forwards
// to src/main.mjs.

export async function runFromConfig(configPath) {
  const {
    runMigration,
    buildAuthHeaders,
    detectLanguages,
    runMultilingualPasses
  } = await import("../../scripts/wp-eleventy-migrate.mjs");

  const absolute = path.resolve(process.cwd(), configPath);
  const rawConfig = JSON.parse(await fs.readFile(absolute, "utf8"));
  const config = await createConfigFromInput(rawConfig);

  const report = await runMigration(absolute);
  output.write(`${JSON.stringify(report, null, 2)}\n`);

  if (config.lang || !config.wpBaseUrl) return;

  const authHeaders = buildAuthHeaders(config);
  const detectedLangs = await detectLanguages(config.wpBaseUrl, authHeaders);
  if (detectedLangs.length <= 1) return;

  const mainLang = detectedLangs[0].code;
  const extraLangs = detectedLangs.filter(l => l.code !== mainLang);
  output.write(`\nDetected ${detectedLangs.length} languages: ${detectedLangs.map(l => `${l.code} (${l.name})`).join(", ")}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    await runMultilingualPasses(config, extraLangs, rl);
  } finally {
    rl.close();
  }
}
