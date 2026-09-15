import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Offline smoke tests for CLI dispatch. Verifies that:
//   1. src/main.mjs and the legacy scripts/wp-eleventy-migrate.mjs entrypoint
//      produce identical user-facing behaviour for the fast-exit paths.
//   2. No network, no readline stdin, no filesystem writes.
//   3. Exit codes are preserved from the pre-modularisation baseline
//      (unknown command → 0, missing config arg → 1).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "test" }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("src/main.mjs run (no config arg) → usage + exit 1", async () => {
  const res = await runNode(["src/main.mjs", "run"]);
  assert.equal(res.code, 1);
  assert.equal(res.signal, null);
  assert.match(res.stdout, /Usage:\s+node src\/main\.mjs run <config\.json>/);
  assert.equal(res.stderr, "");
});

test("scripts/wp-eleventy-migrate.mjs run (compat) → usage + exit 1", async () => {
  const res = await runNode(["scripts/wp-eleventy-migrate.mjs", "run"]);
  assert.equal(res.code, 1);
  assert.equal(res.signal, null);
  assert.match(res.stdout, /Usage:\s+node src\/main\.mjs run <config\.json>/);
  assert.equal(res.stderr, "");
});

test("src/main.mjs unknown-cmd → usage listing + exit 0 (preserved from baseline)", async () => {
  const res = await runNode(["src/main.mjs", "unknown-cmd"]);
  assert.equal(res.code, 0);
  assert.equal(res.signal, null);
  assert.match(res.stdout, /Usage:/);
  assert.match(res.stdout, /node src\/main\.mjs wizard/);
  assert.match(res.stdout, /node src\/main\.mjs run <config\.json>/);
  assert.match(res.stdout, /node src\/main\.mjs serve \[port\]/);
});

test("scripts/wp-eleventy-migrate.mjs unknown-cmd (compat) → usage + exit 0", async () => {
  const res = await runNode(["scripts/wp-eleventy-migrate.mjs", "unknown-cmd"]);
  assert.equal(res.code, 0);
  assert.equal(res.signal, null);
  assert.match(res.stdout, /Usage:/);
});

// Deep-path regression: with a real (but bogus) config arg, dispatch reaches
// cli/run.mjs which dynamically re-imports the engine. Before the shim was
// switched from top-level `await` to queueMicrotask, this path deadlocked
// with "unsettled top-level await" on the compat entrypoint.

const NONEXISTENT_CONFIG = "/tmp/wpe-migrator-nonexistent-config-for-tests.json";

test("src/main.mjs run <bogus-path> → engine loaded, fails with ENOENT, exit 1", async () => {
  const res = await runNode(["src/main.mjs", "run", NONEXISTENT_CONFIG]);
  assert.equal(res.code, 1);
  assert.equal(res.signal, null);
  assert.match(res.stderr, /ENOENT/);
  assert.doesNotMatch(res.stderr, /unsettled top-level await/i);
});

test("scripts/wp-eleventy-migrate.mjs run <bogus-path> (compat) → engine loaded, ENOENT, exit 1, no TLA deadlock", async () => {
  const res = await runNode(["scripts/wp-eleventy-migrate.mjs", "run", NONEXISTENT_CONFIG]);
  assert.equal(res.code, 1);
  assert.equal(res.signal, null);
  assert.match(res.stderr, /ENOENT/);
  assert.doesNotMatch(res.stderr, /unsettled top-level await/i);
});
