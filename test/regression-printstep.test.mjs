import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Regression: PR #1 removed the local `printStep` helper from the engine
// when it moved CLI prompts to src/cli/prompt.mjs, but the engine still
// calls `printStep(...)` from runMigration (four call sites — the first
// unconditional one on the taxonomy fetch step). Any REST-mode run in
// main therefore crashes with `ReferenceError: printStep is not defined`.
//
// This test drives runMigration end-to-end through the shipped CLI
// entrypoint against a loopback mock HTTP server that pretends to be a
// WordPress REST API returning empty collections. No network, no real
// WordPress, no app-password, no user filesystem target.
//
// The assertion is negative + positive:
//   - stderr must NOT contain the `printStep`-related ReferenceError.
//   - stdout must contain `[fetch] Taxonomies from …`, which is the
//     literal output of the first printStep call inside runMigration.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function startMockRestServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // WordPress REST paginated endpoints: return an empty array so
      // fetchAllPages terminates cleanly on the first page.
      res.writeHead(200, {
        "Content-Type": "application/json",
        "X-WP-Total": "0",
        "X-WP-TotalPages": "0"
      });
      res.end("[]");
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
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

test("runMigration reaches printStep without ReferenceError (regression: engine-local shim)", async (t) => {
  const { server, port } = await startMockRestServer();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-printstep-"));
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const outputRoot = path.join(tmpDir, "out");
  await fs.mkdir(outputRoot, { recursive: true });

  const configPath = path.join(tmpDir, "config.json");
  const config = {
    preset: "none",
    siteMode: "existing",
    sourceType: "rest",
    wpBaseUrl: `http://127.0.0.1:${port}`,
    restNamespace: "/wp-json/wp/v2",
    contentTypes: ["posts"],
    includeDrafts: false,
    downloadMedia: false,
    createRedirects: false,
    importMenus: false,
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
    docLayout: "",
    defaultLayout: "",
    convertKadenceBlocks: false,
    kadenceBlocksDir: "_includes/blocks/kadence",
    migrateStyles: false,
    stylesDir: "styles/legacy",
    eleventyReplacements: [],
    siteProfile: null,
    unknownKadenceBlockStrategy: "fallback-html",
    localProjectFolder: "",
    outputRoot,
    contentDir: "content",
    mediaDir: "media",
    dataDir: "_data",
    lang: "",
    langPrefix: ""
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  const res = await runCli(["src/main.mjs", "run", configPath], PROJECT_ROOT);

  assert.doesNotMatch(
    res.stderr,
    /ReferenceError[^\n]*printStep/,
    `runMigration must not throw ReferenceError for printStep. stderr:\n${res.stderr}`
  );
  assert.match(
    res.stdout,
    /\[fetch\] Taxonomies from /,
    `first printStep call inside runMigration should have run. stdout:\n${res.stdout}`
  );
});
