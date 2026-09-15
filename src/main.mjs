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
  if (cmd === "serve") {
    const port = arg ? Number.parseInt(arg, 10) : 4173;
    const engine = await loadEngine();
    await engine.serveUi(Number.isFinite(port) ? port : 4173);
    return;
  }
  output.write("Usage:\n");
  output.write("  node src/main.mjs wizard\n");
  output.write("  node src/main.mjs run <config.json>\n");
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
