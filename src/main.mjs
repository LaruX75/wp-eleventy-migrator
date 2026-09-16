#!/usr/bin/env node

// wp-eleventy-migrator entry point.
//
// Routes CLI subcommands (wizard | run | serve) into the appropriate
// module. The legacy engine at scripts/wp-eleventy-migrate.mjs still
// owns the migration pipeline and the HTTP-served UI; this file is
// the thin dispatch layer that lets the CLI, saved-config runs, and
// GUI share the same public entry.
//
// Import discipline: this module MUST NOT import the engine at the
// top level. The engine's compat shim (scripts/wp-eleventy-migrate.mjs)
// forwards direct invocation here via dynamic import, so a top-level
// engine import would create an initialisation-time cycle. All engine
// access goes through loadEngine() inside main() and inside cli/*
// dispatch functions, which are themselves loaded lazily.
//
// Note (architecture-v2-01): a future UI rewrite is planned as a
// Svelte application on top of a shared src/app/ core. That work is
// out of scope for the CLI/config/main modularisation PR.

import process, { stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

async function loadEngine() {
  return import("../scripts/wp-eleventy-migrate.mjs");
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, arg] = argv;
  if (!cmd || cmd === "wizard") {
    const { runWizard } = await import("./cli/wizard.mjs");
    await runWizard();
    return;
  }
  if (cmd === "run") {
    if (!arg) {
      output.write("Usage: node src/main.mjs run <config.json>\n");
      process.exitCode = 1;
      return;
    }
    const { runFromConfig } = await import("./cli/run.mjs");
    await runFromConfig(arg);
    return;
  }
  if (cmd === "snapshot") {
    if (!arg || argv.length !== 2) {
      output.write("Usage: node src/main.mjs snapshot <config.json>\n");
      process.exitCode = 1;
      return;
    }
    const { runSnapshot } = await import("./app/snapshot.mjs");
    const result = await runSnapshot(arg);
    output.write(`Snapshot ${result.manifest.completeness.status}: ${result.manifestPath}\n`);
    if (result.manifest.completeness.status !== "complete") process.exitCode = 2;
    return;
  }
  if (cmd === "analyze") {
    // First non-flag positional argument after "analyze" is the config path.
    // "--skip-xml-backup" is the only recognised flag; it may appear before
    // or after the config path.
    const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
    const configPath = positional[0];
    if (!configPath) {
      output.write("Usage: node src/main.mjs analyze <config.json> [--skip-xml-backup]\n");
      process.exitCode = 1;
      return;
    }
    const skipXmlBackup = argv.includes("--skip-xml-backup");
    const { runAnalyze } = await import("./app/analyze.mjs");
    const { reportPath, writePlanPath, outputDir } = await runAnalyze(configPath, { skipXmlBackup });
    output.write(`Analyze complete. Output: ${outputDir}\n`);
    output.write(`  ${reportPath}\n`);
    output.write(`  ${writePlanPath}\n`);
    return;
  }
  if (cmd === "serve") {
    const port = arg ? Number.parseInt(arg, 10) : 4173;
    const engine = await loadEngine();
    await engine.serveUi(Number.isFinite(port) ? port : 4173);
    return;
  }
  output.write("Usage:\n");
  output.write("  node src/main.mjs wizard\n");
  output.write("  node src/main.mjs run <config.json>\n");
  output.write("  node src/main.mjs analyze <config.json> [--skip-xml-backup]\n");
  output.write("  node src/main.mjs snapshot <config.json>\n");
  output.write("  node src/main.mjs serve [port]\n");
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err?.stack || err);
    process.exitCode = 1;
  });
}
