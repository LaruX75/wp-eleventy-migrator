import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAnalyze } from "../src/app/analyze.mjs";

// Offline preflight tests. Every test spawns a loopback mock WordPress
// REST server on 127.0.0.1:<random>, hands runAnalyze an isolated tmp
// config + output directory, and asserts on the two produced JSON
// artefacts. Nothing touches real WordPress, real network, real
// credentials, or the project's working directory.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures", "analyze-preflight");
const WXR_PATH = path.join(FIXTURE_DIR, "wxr.xml");

// A test-only fake secret we plant in the config to prove the report is
// redacted. Any occurrence of this string inside migration-report.json
// or write-plan.json fails the test.
const TEST_SECRET = "test-analyze-secret-XYZ-1234";

function buildPostContent(mediaOrigin) {
  return `<!-- wp:paragraph -->
<p>Hello analyze world.</p>
<!-- /wp:paragraph -->

<!-- wp:kadence/rowlayout {"uniqueID":"row_abc"} -->
<div class="kt-row-wrap kt-row-layout-inner"><img src="${mediaOrigin}/wp-content/uploads/2024/01/hero.jpg" alt="hero" /></div>
<!-- /wp:kadence/rowlayout -->

<!-- wp:kadence/notarealblock -->
<div>unknown block should be reported as kadenceUnknown</div>
<!-- /wp:kadence/notarealblock -->`;
}

const PAGE_CONTENT = `<!-- wp:paragraph -->
<p>About page paragraph.</p>
<!-- /wp:paragraph -->`;

function startMockRestServer(baseUrl) {
  return new Promise((resolve) => {
    // The media URL inside post content must point at wpBaseUrl (the
    // mock's own origin) so engine.extractMediaUrls keeps it — that
    // helper filters absolute URLs by wpBaseUrl prefix.
    let mediaOrigin = baseUrl;
    // Externally observable request counter. Tests that need to prove
    // "no REST activity happened" read counter.value after the assert.
    const counter = { value: 0, paths: [] };
    const server = http.createServer((req, res) => {
      counter.value += 1;
      counter.paths.push(req.url);
      const url = new URL(req.url, mediaOrigin);
      const pathname = url.pathname;
      const send = (body, extraHeaders = {}) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "X-WP-Total": String(Array.isArray(body) ? body.length : 0),
          "X-WP-TotalPages": "1",
          ...extraHeaders
        });
        res.end(JSON.stringify(body));
      };
      if (pathname === "/wp-json/wp/v2/categories") {
        send([{ id: 1, name: "Uutiset", slug: "uutiset", count: 1 }]);
        return;
      }
      if (pathname === "/wp-json/wp/v2/tags") {
        send([{ id: 5, name: "tapahtumat", slug: "tapahtumat", count: 1 }]);
        return;
      }
      if (pathname === "/wp-json/wp/v2/posts") {
        const content = buildPostContent(mediaOrigin);
        send([
          {
            id: 2650,
            slug: "hello-analyze",
            date: "2024-06-01T09:00:00",
            link: `${mediaOrigin}/hello-analyze/`,
            title: { rendered: "Hello Analyze" },
            content: { rendered: content, raw: content }
          }
        ]);
        return;
      }
      if (pathname === "/wp-json/wp/v2/pages") {
        send([
          {
            id: 100,
            slug: "about",
            date: "2024-05-01T09:00:00",
            link: `${mediaOrigin}/about/`,
            title: { rendered: "About" },
            content: { rendered: PAGE_CONTENT, raw: PAGE_CONTENT }
          }
        ]);
        return;
      }
      // Language detection endpoints — respond 404 so detectLanguages
      // returns [] gracefully (single-language site).
      if (pathname === "/wp-json/wpml/v1/languages" || pathname === "/wp-json/pll/v1/languages") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      mediaOrigin = `http://127.0.0.1:${port}`;
      resolve({ server, port, counter });
    });
  });
}

// Lightweight sandbox for XML-gate failure tests: spins up the mock REST
// server (so its counter is observable), writes a config that points
// wpBaseUrl at the mock, and lets the caller override / omit config
// fields to trigger each gate condition. The mock IS meant to be
// reachable — the test proves the gate refused BEFORE any request
// arrived by asserting counter.value === 0 after the reject.
async function makeMockRestSandbox(t, configOverrides = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-analyze-gate-"));
  const analysisOutputDir = path.join(tmpDir, "analysis-out");
  await fs.mkdir(analysisOutputDir, { recursive: true });

  const { server, port, counter } = await startMockRestServer("http://127.0.0.1:0");
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const baseConfig = {
    preset: "none",
    sourceType: "rest",
    wpBaseUrl: `http://127.0.0.1:${port}`,
    restNamespace: "/wp-json/wp/v2",
    contentTypes: "posts,pages",
    authMode: "none",
    analysisOutputDir
    // xmlBackupPath deliberately not set — caller decides.
  };
  const config = { ...baseConfig, ...configOverrides };
  // Allow caller to force-remove keys by setting them to undefined.
  for (const key of Object.keys(config)) {
    if (config[key] === undefined) delete config[key];
  }
  const configPath = path.join(tmpDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  return { tmpDir, configPath, analysisOutputDir, counter, port };
}

async function makeSandbox(t, { xmlPath = WXR_PATH, authMode = "none", planted = {} } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-analyze-"));
  const analysisOutputDir = path.join(tmpDir, "analysis-out");
  await fs.mkdir(analysisOutputDir, { recursive: true });

  const baseUrl = "http://127.0.0.1"; // port filled below
  const { server, port, counter } = await startMockRestServer(`${baseUrl}:0`);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const rawConfig = {
    preset: "none",
    sourceType: "rest",
    wpBaseUrl: `${baseUrl}:${port}`,
    restNamespace: "/wp-json/wp/v2",
    contentTypes: "posts,pages",
    authMode,
    xmlBackupPath: xmlPath,
    analysisOutputDir,
    ...planted
  };
  const configPath = path.join(tmpDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), "utf8");

  return { tmpDir, configPath, analysisOutputDir, port };
}

test("analyze: valid XML + mock REST → report + write plan, no side artefacts, no secret leak", async (t) => {
  const { configPath, analysisOutputDir, tmpDir } = await makeSandbox(t, {
    authMode: "app-password",
    planted: {
      wpUser: "editor",
      wpAppPassword: TEST_SECRET,
      wpBearerToken: ""
    }
  });

  const { reportPath, writePlanPath, outputDir } = await runAnalyze(configPath, { skipXmlBackup: false });

  assert.equal(outputDir, analysisOutputDir);
  const reportRaw = await fs.readFile(reportPath, "utf8");
  const planRaw = await fs.readFile(writePlanPath, "utf8");
  const report = JSON.parse(reportRaw);
  const plan = JSON.parse(planRaw);

  // Redaction: the secret must never appear in either artefact.
  assert.doesNotMatch(reportRaw, new RegExp(TEST_SECRET), "report leaked plaintext secret");
  assert.doesNotMatch(planRaw, new RegExp(TEST_SECRET), "write plan leaked plaintext secret");
  assert.equal(report.effectiveConfig.wpAppPassword, "[REDACTED]");

  // XML preflight verified.
  assert.equal(report.xmlBackup.status, "verified");
  assert.equal(typeof report.xmlBackup.sha256, "string");
  assert.equal(report.xmlBackup.sha256.length, 64);
  assert.ok(report.xmlBackup.sizeBytes > 0);

  // Content types + taxonomies discovered.
  assert.deepEqual(
    plan.contentTypes.map((c) => c.type).sort(),
    ["pages", "posts"]
  );
  const postsEntry = plan.contentTypes.find((c) => c.type === "posts");
  assert.equal(postsEntry.count, 1);
  assert.deepEqual(
    plan.taxonomies.map((t2) => `${t2.type}:${t2.count}`).sort(),
    ["category:1", "post_tag:1"]
  );

  // Documents include deterministic target paths + source IDs.
  assert.equal(plan.documents.length, 2);
  const postDoc = plan.documents.find((d) => d.type === "posts");
  assert.equal(postDoc.sourceId, 2650);
  assert.equal(postDoc.slug, "hello-analyze");
  assert.equal(postDoc.targetPath, "content/posts/2024-06-01-hello-analyze.md");
  assert.match(postDoc.targetPermalink, /^\//);
  const pageDoc = plan.documents.find((d) => d.type === "pages");
  assert.equal(pageDoc.targetPath, "content/pages/about.md");

  // Blocks: gutenberg "paragraph" (engine parseWpBlocks preserves the
  // raw block name; core-namespaced blocks appear without the "core/"
  // prefix), kadence supported rowlayout, and one kadence/unknown
  // block reported separately.
  const paragraph = plan.blocks.gutenberg.find((b) => b.name === "paragraph");
  assert.ok(paragraph && paragraph.count >= 1, "core paragraph block should be classified as gutenberg");
  const kadenceRow = plan.blocks.kadence.find((b) => b.name === "kadence/rowlayout");
  assert.ok(kadenceRow, "kadence/rowlayout should be recognised");
  const unknownKadence = plan.blocks.kadenceUnknown.find((b) => b.name === "kadence/notarealblock");
  assert.ok(unknownKadence, "unknown kadence block should surface in kadenceUnknown");

  // Media URLs counted but not downloaded.
  assert.ok(plan.media.urlCount >= 1);
  assert.match(plan.media.warning, /does not download/i);

  // Translations: single-language mock → status must NOT be "unresolved".
  assert.equal(plan.translations.status, "single-language");

  // Side-effect audit: analysisOutputDir contains ONLY the two JSON files.
  const analysisContents = await fs.readdir(analysisOutputDir);
  assert.deepEqual(analysisContents.sort(), ["migration-report.json", "write-plan.json"]);
  // Nothing written under tmpDir other than config.json, analysis-out, and its two files.
  const tmpTop = await fs.readdir(tmpDir);
  assert.deepEqual(tmpTop.sort(), ["analysis-out", "config.json"]);

  // Report mode + capability wording.
  assert.equal(report.mode, "analyze-only");
  assert.match(
    report.capability.contextEditNote,
    /does not guarantee complete Yoast/i
  );
});

test("analyze: missing xmlBackupPath → refuses before touching REST (counter proves 0 requests)", async (t) => {
  // wpBaseUrl points at a REACHABLE mock so the counter can prove no
  // request was ever made — not just "an unreachable port was set".
  const { configPath, counter, tmpDir } = await makeMockRestSandbox(t, {
    // xmlBackupPath INTENTIONALLY OMITTED
  });

  await assert.rejects(
    runAnalyze(configPath, { skipXmlBackup: false }),
    /xmlBackupPath is required/i
  );

  // Externally-observable proof: the mock REST server received zero requests.
  assert.equal(
    counter.value,
    0,
    `analyze must not touch REST when the XML gate refuses. Observed requests: ${counter.paths.join(", ")}`
  );

  // No analysis artefacts should exist either.
  const reportExists = await fs
    .access(path.join(tmpDir, "analysis-out", "migration-report.json"))
    .then(() => true)
    .catch(() => false);
  assert.equal(reportExists, false);
});

test("analyze: xmlBackupPath points at a non-WXR file → refuses (counter proves 0 requests)", async (t) => {
  // Stage the bogus XML in its own tmp dir so it lives independently of the
  // sandbox tmpDir cleanup order.
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-analyze-badxml-src-"));
  t.after(() => fs.rm(stagingDir, { recursive: true, force: true }));
  const bogusXml = path.join(stagingDir, "not-wxr.xml");
  await fs.writeFile(bogusXml, "this file is not a WordPress WXR export\n", "utf8");

  const { configPath, counter } = await makeMockRestSandbox(t, {
    xmlBackupPath: bogusXml
  });

  await assert.rejects(
    runAnalyze(configPath, { skipXmlBackup: false }),
    /does not look like a WordPress WXR export/i
  );

  assert.equal(
    counter.value,
    0,
    `analyze must not touch REST when XML content is invalid. Observed requests: ${counter.paths.join(", ")}`
  );
});

test("analyze: skipXmlBackup config flag alone does NOT bypass the gate (counter proves 0 requests)", async (t) => {
  const { configPath, counter } = await makeMockRestSandbox(t, {
    // A user might expect this to work. It must NOT.
    skipXmlBackup: true
    // xmlBackupPath still omitted.
  });

  await assert.rejects(
    runAnalyze(configPath, { skipXmlBackup: false }),
    /xmlBackupPath is required/i,
    "config-level skipXmlBackup must not open the gate"
  );

  assert.equal(
    counter.value,
    0,
    `analyze must not touch REST when only config-level skipXmlBackup is set. Observed requests: ${counter.paths.join(", ")}`
  );
});

test("analyze: --skip-xml-backup CLI option → skipped status + visible warning", async (t) => {
  const { configPath, analysisOutputDir } = await makeSandbox(t, { xmlPath: "" });

  const { reportPath, writePlanPath } = await runAnalyze(configPath, { skipXmlBackup: true });
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const plan = JSON.parse(await fs.readFile(writePlanPath, "utf8"));

  assert.equal(report.xmlBackup.status, "skipped");
  assert.equal(typeof report.xmlBackup.skippedAt, "string");
  assert.match(report.xmlBackup.warning, /--skip-xml-backup/);
  assert.match(report.xmlBackup.warning, /real migration/i);

  // The warning is also present in the top-level report + plan warnings list
  // so it is impossible to miss when consuming either artefact.
  assert.ok(
    report.warnings.some((w) => /skip-xml-backup/i.test(w)),
    "top-level warnings should surface the XML skip"
  );
  assert.ok(
    plan.warnings.some((w) => /skip-xml-backup/i.test(w)),
    "write plan warnings should surface the XML skip"
  );

  // Analyze still ran and produced a plan.
  assert.equal(plan.contentTypes.length, 2);

  // Analysis output dir contains ONLY the two JSON files.
  const analysisContents = await fs.readdir(analysisOutputDir);
  assert.deepEqual(analysisContents.sort(), ["migration-report.json", "write-plan.json"]);
});

test("analyze: relative xmlBackupPath is resolved from the config file's directory (successful run)", async (t) => {
  // Build a self-contained sandbox where BOTH the config file and its WXR
  // sibling live inside tmpDir. xmlBackupPath is set to "./wxr.xml", so
  // the only way analyze can find it is by resolving relative to the
  // config file's own directory (configDir), not process.cwd() and not
  // the analysisOutputDir.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-analyze-relxml-"));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const analysisOutputDir = path.join(tmpDir, "analysis-out");
  await fs.mkdir(analysisOutputDir, { recursive: true });

  // Copy the shared WXR fixture into the config's own directory.
  const wxrSibling = path.join(tmpDir, "wxr.xml");
  await fs.copyFile(WXR_PATH, wxrSibling);

  const { server, port, counter } = await startMockRestServer("http://127.0.0.1:0");
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const configPath = path.join(tmpDir, "config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        preset: "none",
        sourceType: "rest",
        wpBaseUrl: `http://127.0.0.1:${port}`,
        restNamespace: "/wp-json/wp/v2",
        contentTypes: "posts,pages",
        authMode: "none",
        xmlBackupPath: "./wxr.xml",
        analysisOutputDir
      },
      null,
      2
    ),
    "utf8"
  );

  // Guard: ensure process.cwd() cannot resolve "./wxr.xml" — the test would
  // otherwise pass by accident even if configDir-resolution were broken.
  const cwdCollision = path.resolve(process.cwd(), "wxr.xml");
  const cwdCollisionExists = await fs
    .access(cwdCollision)
    .then(() => true)
    .catch(() => false);
  assert.equal(
    cwdCollisionExists,
    false,
    `test guard failed: process.cwd() already contains wxr.xml (${cwdCollision})`
  );

  const { reportPath } = await runAnalyze(configPath, { skipXmlBackup: false });
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

  // XML verified — status field carries the report-schema contract.
  assert.equal(report.xmlBackup.status, "verified");
  assert.equal(typeof report.xmlBackup.sha256, "string");
  assert.equal(report.xmlBackup.sha256.length, 64);
  assert.ok(report.xmlBackup.sizeBytes > 0);
  // The absolute path in the report must be the sibling copy, not the
  // shared fixture at test/fixtures/analyze-preflight/wxr.xml. That is
  // the only outcome consistent with configDir-relative resolution.
  assert.equal(report.xmlBackup.filename, path.resolve(tmpDir, "wxr.xml"));
  assert.notEqual(report.xmlBackup.filename, WXR_PATH);

  // Successful run must have made real REST calls. We do not lock the
  // exact count (it depends on optional WPML/PLL language sniffs) but
  // the four core WP endpoints have to be present.
  assert.ok(
    counter.value >= 4,
    `expected ≥ 4 REST requests on a successful analyze; got ${counter.value}: ${counter.paths.join(", ")}`
  );
  const pathsSeen = counter.paths.map((u) => u.split("?")[0]);
  for (const expected of [
    "/wp-json/wp/v2/categories",
    "/wp-json/wp/v2/tags",
    "/wp-json/wp/v2/posts",
    "/wp-json/wp/v2/pages"
  ]) {
    assert.ok(
      pathsSeen.includes(expected),
      `expected REST call ${expected} to be present. Observed: ${pathsSeen.join(", ")}`
    );
  }
});
