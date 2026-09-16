import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { runSnapshot } from "../src/app/snapshot.mjs";
import { openSnapshot, sha256 } from "../src/source/snapshot.mjs";
import { runAnalyze } from "../src/app/analyze.mjs";
import { runMigration } from "../scripts/wp-eleventy-migrate.mjs";
import { createConfigFromInput } from "../src/config/normalize.mjs";
import * as site from "./fixtures/rest-snapshot/site.mjs";

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-snapshot-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = { WP_USER: process.env.WP_USER, WP_APP_PASSWORD: process.env.WP_APP_PASSWORD };
  process.env.WP_USER = "fixture-user";
  process.env.WP_APP_PASSWORD = "fixture-secret-never-persist";
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const requests = [];
  const collections = structuredClone(site.collections);
  options.change?.(collections);
  t.mock.method(globalThis, "fetch", async (value, init = {}) => {
    const url = new URL(value);
    requests.push({ url: url.href, ...init });
    if (options.networkFailure) throw new Error(process.env.WP_APP_PASSWORD);
    if (url.pathname === "/wp-json") return Response.json(options.discovery || site.discovery);
    if (url.pathname === "/wp-json/wp/v2/types") return Response.json(site.types);
    if (url.pathname === "/wp-json/wp/v2/taxonomies") return Response.json(site.taxonomies);
    const pages = collections[url.pathname.replace(/^\/wp-json/, "")];
    if (pages) {
      const page = Number(url.searchParams.get("page"));
      if (options.failSecondPage && page === 2) return Response.json({ message: process.env.WP_APP_PASSWORD }, { status: 500 });
      const rows = pages[page - 1] || [];
      const headers = options.noTotals ? {} : { "x-wp-totalpages": String(pages.length), "x-wp-total": String(pages.flat().length) };
      return Response.json(rows, { headers });
    }
    if (url.pathname.includes("/wp-content/")) return new Response(options.emptyMedia ? "" : site.IMAGE_BYTES, {
      status: options.failMedia ? 503 : 200, headers: { "content-type": options.wrongMime ? "text/html" : "image/png" }
    });
    throw new Error("Unexpected fixture request");
  });
  const config = {
    sourceType: "rest", wpBaseUrl: site.baseUrl, authMode: "app-password", snapshotOutputDir: "capture",
    xmlBackupPath: path.resolve("test/fixtures/analyze-preflight/wxr.xml"), ...options.config
  };
  const configPath = path.join(root, "capture.json");
  await fs.writeFile(configPath, JSON.stringify(config));
  return { root, config, configPath, requests, capture: () => runSnapshot(configPath) };
}

async function offlineConfig(f, extra = {}) {
  const config = await createConfigFromInput({ sourceType: "snapshot", snapshotPath: "capture", contentTypes: "posts,pages,books",
    outputRoot: path.join(f.root, "output"), analysisOutputDir: "analysis", dryRun: false, downloadMedia: true,
    siteMode: "new", importMenus: true, migrateStyles: true, ...extra });
  const configPath = path.join(f.root, "offline.json");
  await fs.writeFile(configPath, JSON.stringify(config));
  return { config, configPath };
}
function disableNetwork(t) {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; throw new Error("Network is disabled"); });
  return () => assert.equal(calls, 0);
}

test("capture paginates, discovers custom namespaces/taxonomies, preserves whole records and local media", async (t) => {
  const f = await fixture(t);
  const { manifest, snapshotDir } = await f.capture();
  assert.equal(manifest.completeness.status, "complete");
  const posts = manifest.collections.find((c) => c.restBase === "posts");
  assert.equal(posts.pages.length, 2);
  assert.equal(posts.count, 2);
  assert.equal(posts.contentForms.both, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(snapshotDir, posts.pages[0].file))), [site.firstPost]);
  assert.ok(manifest.collections.some((c) => c.route === "/library/v1/books" && c.count === 1));
  assert.ok(manifest.collections.some((c) => c.restBase === "genres" && c.count === 1));
  assert.deepEqual(manifest.media[123].record, site.attachment);
  assert.deepEqual(await fs.readFile(path.join(snapshotDir, manifest.media[123].files[0].localPath)), site.IMAGE_BYTES);
  assert.equal(manifest.media[123].files[0].sha256, sha256(site.IMAGE_BYTES));
  for (const request of f.requests) {
    assert.match(request.headers.Authorization, /^Basic /);
    assert.equal(request.redirect, "error");
    assert.ok(!request.method || request.method === "GET");
    if (request.url.includes("per_page=")) assert.equal(new URL(request.url).searchParams.get("context"), "edit");
  }
  assert.match(f.requests.find((r) => r.url.includes("/posts?")).url, /status=.*trash/);
  for (const file of ["manifest.json", ...Object.keys(manifest.files)]) assert.doesNotMatch((await fs.readFile(path.join(snapshotDir, file))).toString(), /fixture-secret-never-persist|Basic /);
});

for (const [name, options] of [["HTTP failure", { failMedia: true }], ["wrong MIME", { wrongMime: true }], ["empty response", { emptyMedia: true }]]) {
  test(`${name}: retain attachment metadata, mark incomplete, never guess a download URL`, async (t) => {
    const f = await fixture(t, options);
    const { manifest } = await f.capture();
    assert.equal(manifest.completeness.status, "incomplete");
    assert.equal(manifest.completeness.counts.failedMediaFiles, 1);
    assert.deepEqual(manifest.media[123].record, site.attachment);
    assert.equal(manifest.media[123].files[0].localPath, null);
    assert.ok(manifest.media[123].files[0].failure);
    assert.deepEqual(f.requests.filter((r) => !r.url.includes("/wp-json")).map((r) => r.url), [site.attachment.source_url]);
  });
}

test("unknown IDs and external references are complete-with-unresolved-media without speculative fetches", async (t) => {
  const f = await fixture(t, { change(c) { c["/wp/v2/posts"][0][0].content.raw += '[vc_single_image image="999"]<img src="https://external.example/unknown.png">'; } });
  const { manifest } = await f.capture();
  assert.equal(manifest.completeness.status, "complete-with-unresolved-media");
  assert.equal(manifest.completeness.counts.unresolvedMediaReferences, 2);
  assert.ok(manifest.unresolvedMedia.some((m) => m.attachmentId === 999));
  assert.ok(f.requests.every((r) => !r.url.includes("999") && !r.url.includes("external.example")));
});

for (const [name, options] of [["failed second page", { failSecondPage: true }], ["missing totals", { noTotals: true }], ["failed discovery", { networkFailure: true }]]) {
  test(`${name} cannot report a complete snapshot or leak response errors`, async (t) => {
    const f = await fixture(t, options);
    const { manifest } = await f.capture();
    assert.equal(manifest.completeness.status, "incomplete");
    assert.ok(manifest.completeness.reasons.length);
    assert.doesNotMatch(JSON.stringify(manifest), /fixture-secret-never-persist/);
  });
}

test("analyze works after moving snapshot and deleting capture config, with network disabled", async (t) => {
  const f = await fixture(t); await f.capture();
  await fs.rename(path.join(f.root, "capture"), path.join(f.root, "moved"));
  await fs.rm(f.configPath);
  const { configPath } = await offlineConfig(f, { snapshotPath: "moved" });
  const check = disableNetwork(t);
  const result = await runAnalyze(configPath);
  const report = JSON.parse(await fs.readFile(result.reportPath));
  const plan = JSON.parse(await fs.readFile(result.writePlanPath));
  assert.equal(report.totals.documents, 3);
  assert.equal(report.auth.mode, "offline");
  assert.equal(report.snapshot.status, "complete");
  assert.equal(report.xmlBackup.status, "verified");
  assert.ok(plan.documents[0].shortcodes.some((s) => s.name === "vc_single_image"));
  check();
});

test("migration uses existing WPBakery/media/output contracts offline, including CLI follow-up", async (t) => {
  const f = await fixture(t); await f.capture();
  const { configPath } = await offlineConfig(f);
  const check = disableNetwork(t);
  const report = await runMigration(configPath);
  assert.equal(report.snapshot.status, "complete");
  assert.equal(report.install.reason, "offline-snapshot");
  assert.equal(report.totals.posts, 2);
  assert.equal(report.totals.books, 1);
  const output = await fs.readFile(path.join(f.root, "output/content/posts/2021-09-07-snapshot.md"), "utf8");
  assert.match(output, /<figure class="wp-attachment-image"/);
  assert.match(output, /src="\/media\/wp-content\/uploads\/2021\/09\/event.png"/);
  assert.match(output, /sourceId: 1/);
  assert.match(output, /Test author/);
  assert.doesNotMatch(output, /\[vc_|wp-media-unresolved/);
  assert.deepEqual(await fs.readFile(path.join(f.root, "output/media/wp-content/uploads/2021/09/event.png")), site.IMAGE_BYTES);
  check();
  await offlineConfig(f, { outputRoot: path.join(f.root, "cli-output") });
  const result = spawnSync(process.execPath, ["--import", 'data:text/javascript,globalThis.fetch=()=>{process.stderr.write("NETWORK_ATTEMPT");throw new Error("disabled")}', "src/main.mjs", "run", configPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr + result.stdout, /NETWORK_ATTEMPT/);
});

test("failed local media stay unresolved offline without rewriting to nonexistent paths", async (t) => {
  const f = await fixture(t, { failMedia: true }); await f.capture();
  const { configPath } = await offlineConfig(f);
  const check = disableNetwork(t);
  const report = await runMigration(configPath);
  const output = await fs.readFile(path.join(f.root, "output/content/posts/2021-09-07-snapshot.md"), "utf8");
  assert.equal(report.snapshot.status, "incomplete");
  assert.match(output, /data-media-unresolved-id="123"/);
  assert.match(output, /featuredImage: "https:\/\/wordpress.example/);
  assert.doesNotMatch(output, /src="\/media\//);
  check();
});

test("reader rejects corrupted records and unsafe paths; missing asset is explicit incompleteness", async (t) => {
  const f = await fixture(t); const { manifest, snapshotDir } = await f.capture();
  const { config } = await offlineConfig(f);
  await fs.rm(path.join(snapshotDir, manifest.media[123].files[0].localPath));
  const source = await openSnapshot(config, f.root);
  assert.equal(source.completeness.status, "incomplete");
  assert.equal(source.completeness.counts.localMediaFailures, 1);
  const file = manifest.collections[0].pages[0].file;
  await fs.appendFile(path.join(snapshotDir, file), " ");
  await assert.rejects(openSnapshot(config, f.root), /checksum mismatch/);
  manifest.xmlBackup.filename = "../capture.json";
  manifest.files["../capture.json"] = { byteCount: 1, sha256: "invalid" };
  const bytes = JSON.stringify(manifest);
  await fs.writeFile(path.join(snapshotDir, "manifest.json"), bytes);
  await fs.writeFile(path.join(snapshotDir, "manifest.sha256"), sha256(bytes));
  await assert.rejects(openSnapshot(config, f.root), /Unsafe snapshot path/);
});

for (const [name, config, pattern] of [
  ["public auth", { authMode: "none" }, /app-password/], ["HTTP", { wpBaseUrl: "http://wordpress.example" }, /HTTPS/],
  ["config secret", { wpAppPassword: "forbidden" }, /environment|not config/],
  ["no WXR", { xmlBackupPath: "" }, /xmlBackupPath/], ["bad WXR", { xmlBackupPath: "absent.xml" }, /XML backup not found/]
]) test(`capture refuses ${name} before any network or snapshot write`, async (t) => {
  const f = await fixture(t, { config });
  await assert.rejects(f.capture(), pattern);
  assert.equal(f.requests.length, 0);
  await assert.rejects(fs.access(path.join(f.root, "capture")));
});

test("raw-only records remain intact and pass through the existing migration transform", async (t) => {
  const f = await fixture(t, { change(c) { delete c["/wp/v2/posts"][0][0].content.rendered; } });
  const { manifest } = await f.capture();
  assert.equal(manifest.collections[0].contentForms.rawOnly, 1);
  const { configPath } = await offlineConfig(f);
  const check = disableNetwork(t);
  await runMigration(configPath);
  assert.match(await fs.readFile(path.join(f.root, "output/content/posts/2021-09-07-snapshot.md"), "utf8"), /<figure class="wp-attachment-image"/);
  check();
});

test("secret-bearing REST records are not persisted or partially reduced", async (t) => {
  const f = await fixture(t, { change(c) { c["/wp/v2/posts"][0][0].meta.api_token = "private-value"; } });
  const { manifest, snapshotDir } = await f.capture();
  assert.equal(manifest.completeness.status, "incomplete");
  assert.equal(manifest.collections[0].failure, "secret-material-detected");
  assert.deepEqual(manifest.collections[0].pages, []);
  for (const file of Object.keys(manifest.files)) assert.doesNotMatch((await fs.readFile(path.join(snapshotDir, file))).toString(), /private-value/);
});

test("authoritative CDN files and size variants are captured without sending WordPress credentials off-origin", async (t) => {
  const f = await fixture(t, { change(c) {
    const record = c["/wp/v2/media"][0][0];
    record.source_url = record.source_url.replace("wordpress.example", "cdn.example");
    record.media_details = { sizes: { thumbnail: { source_url: `${site.baseUrl}/wp-content/uploads/small.png`, mime_type: "image/png" } } };
    for (const pages of Object.values(c)) for (const record of pages.flat()) if (record.content) record.content = { rendered: '<img src="https://cdn.example/wp-content/uploads/2021/09/event.png" srcset="/wp-content/uploads/small.png 100w">' };
  } });
  const { manifest } = await f.capture();
  assert.equal(manifest.completeness.status, "complete");
  assert.equal(manifest.media[123].files.length, 2);
  assert.equal(f.requests.find((r) => r.url.includes("cdn.example")).headers.Authorization, undefined);
  const { configPath } = await offlineConfig(f);
  const check = disableNetwork(t);
  await runMigration(configPath);
  const output = await fs.readFile(path.join(f.root, "output/content/posts/2021-09-07-snapshot.md"), "utf8");
  assert.match(output, /src="\/media\/_external\/cdn.example\//);
  assert.match(output, /srcset="\/media\/wp-content\/uploads\/small.png 100w"/);
  check();
});

test("same-path media with different query URLs cannot overwrite each other or become false local mappings", async (t) => {
  const f = await fixture(t, { change(c) {
    const record = c["/wp/v2/media"][0][0];
    record.media_details = { sizes: { alternate: { source_url: `${record.source_url}?size=alternate`, mime_type: "image/png" } } };
  } });
  await f.capture();
  const { configPath } = await offlineConfig(f);
  const check = disableNetwork(t);
  const report = await runMigration(configPath);
  assert.equal(report.snapshot.status, "incomplete");
  assert.equal(report.snapshot.counts.localMediaCopyFailures, 2);
  assert.match(await fs.readFile(path.join(f.root, "output/content/posts/2021-09-07-snapshot.md"), "utf8"), /data-media-unresolved-id="123"/);
  await assert.rejects(fs.access(path.join(f.root, "output/media/wp-content/uploads/2021/09/event.png")));
  check();
});

test("duplicate IDs fail pagination and incomplete requested collections are refused offline", async (t) => {
  const f = await fixture(t, { change(c) { c["/wp/v2/posts"][1][0].id = 1; } });
  const { manifest } = await f.capture();
  assert.equal(manifest.collections[0].failure, "invalid-or-duplicate-record-id");
  assert.equal(manifest.collections[0].count, 1);
  const { configPath } = await offlineConfig(f);
  const check = disableNetwork(t);
  await assert.rejects(runAnalyze(configPath), /collection is incomplete/);
  await assert.rejects(runMigration(configPath), /collection is incomplete/);
  await assert.rejects(fs.access(path.join(f.root, "output")));
  check();
});

test("captured WXR is mandatory for offline reads even when analyze skip is requested", async (t) => {
  const f = await fixture(t); const { snapshotDir } = await f.capture();
  await fs.rm(path.join(snapshotDir, "backup/source.xml"));
  const { configPath } = await offlineConfig(f);
  const check = disableNetwork(t);
  await assert.rejects(runAnalyze(configPath, { skipXmlBackup: true }), /ENOENT/);
  await assert.rejects(runMigration(configPath), /ENOENT/);
  check();
});

test("existing snapshot directories are never overwritten", async (t) => {
  const f = await fixture(t); await f.capture();
  const before = f.requests.length;
  await assert.rejects(f.capture(), /EEXIST/);
  assert.equal(f.requests.length, before);
});

test("missing environment credentials fail before preflight and network", async (t) => {
  const f = await fixture(t);
  delete process.env.WP_APP_PASSWORD;
  await assert.rejects(f.capture(), /WP_APP_PASSWORD/);
  assert.equal(f.requests.length, 0);
});

test("credential-bearing URLs in returned records are refused without persisting them", async (t) => {
  const f = await fixture(t, { change(c) { c["/wp/v2/media"][0][0].source_url += "?token=must-not-be-saved"; } });
  const { manifest } = await f.capture();
  assert.equal(manifest.collections.find((c) => c.kind === "media").failure, "secret-material-detected");
  assert.doesNotMatch(JSON.stringify(manifest), /must-not-be-saved/);
});

test("capture CLI dispatch reports completeness and exposes no credentials", async (t) => {
  const f = await fixture(t);
  const { main } = await import("../src/main.mjs");
  const oldExitCode = process.exitCode;
  t.after(() => { process.exitCode = oldExitCode; });
  await main(["snapshot", f.configPath]);
  assert.equal(process.exitCode, oldExitCode);
  const manifest = JSON.parse(await fs.readFile(path.join(f.root, "capture/manifest.json")));
  assert.equal(manifest.completeness.status, "complete");
});

test("credential-bearing WXR is refused before a snapshot is written", async (t) => {
  const f = await fixture(t);
  const backup = path.join(f.root, "secret-backup.xml");
  await fs.writeFile(backup, '<?xml version="1.0"?><rss xmlns:wp="urn:wordpress"><wp:post_password><![CDATA[protected-post-secret]]></wp:post_password></rss>');
  await fs.writeFile(f.configPath, JSON.stringify({ ...f.config, xmlBackupPath: backup }));
  await assert.rejects(f.capture(), /secret-material-detected/);
  await assert.rejects(fs.access(path.join(f.root, "capture")));
  assert.equal(f.requests.length, 0);
});
