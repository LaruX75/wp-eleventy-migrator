import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMigration, itemToDoc } from "../scripts/wp-eleventy-migrate.mjs";
import { createConfigFromInput } from "../src/config/normalize.mjs";
import { collectWpBakeryMediaIds, transformWpBakery } from "../src/blocks/page-builders/wpbakery.mjs";
import { MEDIA_RECORD, MEDIA_BODY, IMAGE_BYTES } from "./fixtures/wpbakery-content/media.mjs";

async function migrate(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-attachment-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [];
  const posts = options.posts || [{
    id: 1, slug: "event", status: "publish", date: "2021-09-07T12:00:00",
    title: { rendered: "Community day" }, content: { rendered: options.body || MEDIA_BODY },
    ...(options.embedded ? { _embedded: { "wp:featuredmedia": [options.embedded] } } : {})
  }];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({ url: String(url), authorization: init.headers?.Authorization });
    if (parsed.pathname.endsWith("/categories") || parsed.pathname.endsWith("/tags")) return Response.json([]);
    if (parsed.pathname.endsWith("/posts")) return Response.json(posts, { headers: { "X-WP-TotalPages": "1" } });
    if (/\/media\/\d+$/.test(parsed.pathname)) {
      if (options.lookupThrows) throw new Error("offline-test-token must not reach reports");
      return Response.json(options.record === undefined ? MEDIA_RECORD : options.record, { status: options.lookupStatus || 200 });
    }
    if (parsed.pathname.includes("/wp-content/")) {
      return new Response(options.emptyDownload ? "" : IMAGE_BYTES, {
        status: options.downloadStatus || 200,
        headers: { "content-type": options.downloadMime || "image/png" }
      });
    }
    throw new Error(`Unexpected offline request: ${parsed.pathname}`);
  });
  const config = await createConfigFromInput({
    wpBaseUrl: "https://wordpress.example", siteMode: "existing", outputRoot: root,
    contentTypes: "posts", downloadMedia: true, dryRun: false,
    createRedirects: false, importMenus: false, authMode: "bearer", wpBearerToken: "offline-test-token",
    ...options.config
  });
  const report = await runMigration(null, config);
  const output = config.dryRun ? "" : await fs.readFile(path.join(root, "content/posts/2021-09-07-event.md"), "utf8");
  return { root, output, report, requests, config };
}

function coverage(result) { return result.report.transformerCoverage.documents[0]; }
function imageDiagnostics(result) { return coverage(result).unhandledUnits.filter((unit) => unit.unit === "vc_single_image"); }
function mediaRequests(result) { return result.requests.filter(({ url }) => /\/media\/\d+/.test(url)); }
function downloadRequests(result) { return result.requests.filter(({ url }) => url.includes("/wp-content/")); }

for (const htmlMode of ["keep-html", "basic-markdown"]) {
  test(`attachment resolves through authenticated REST to a local semantic image (${htmlMode})`, async (t) => {
    const result = await migrate(t, { config: { htmlMode } });
    assert.match(result.output, /<figure class="wp-attachment-image" data-attachment-id="123">/);
    assert.match(result.output, /<img src="\/media\/wp-content\/uploads\/2021\/09\/event.png" alt="An event &amp; &quot;friends&quot;"/);
    assert.match(result.output, /<figcaption>Community day &amp; fun\.<\/figcaption>/);
    assert.doesNotMatch(result.output, /\[\/?vc_|wp-media-unresolved|private/);
    assert.match(result.output, /Everyone is welcome\./);
    assert.match(result.output, /Community day/);
    if (htmlMode === "keep-html") {
      assert.match(result.output, /<iframe src="https:\/\/www.youtube.com\/embed\/dQw4w9WgXcQ"/);
      assert.match(result.output, /class="wp-empty-space"/);
    }
    assert.deepEqual(await fs.readFile(path.join(result.root, "media/wp-content/uploads/2021/09/event.png")), IMAGE_BYTES);
    assert.deepEqual(imageDiagnostics(result), []);
    assert.equal(coverage(result).handledUnits.find((unit) => unit.unit === "vc_single_image").count, 1);
    assert.notEqual(coverage(result).overallStatus, "manual-review");
    assert.equal(mediaRequests(result).length, 1);
    assert.equal(mediaRequests(result)[0].authorization, "Bearer offline-test-token");
    assert.equal(downloadRequests(result)[0].authorization, "Bearer offline-test-token");
    const savedReport = await fs.readFile(result.report.reportPath, "utf8");
    assert.doesNotMatch(savedReport, /offline-test-token/);
    assert.deepEqual(JSON.parse(savedReport).transformerCoverage, result.report.transformerCoverage);
  });
}

test("embedded authoritative media skips REST lookup and repeated IDs reuse the established mapping", async (t) => {
  const result = await migrate(t, { embedded: MEDIA_RECORD, body: MEDIA_BODY + '[vc_single_image image="123"]' });
  assert.equal(mediaRequests(result).length, 0);
  assert.equal(downloadRequests(result).length, 1);
  assert.equal(coverage(result).handledUnits.find((unit) => unit.unit === "vc_single_image").count, 2);
  assert.equal((result.output.match(/<img /g) || []).length, 2);
});

test("missing and invalid ID attributes stay unresolved without lookup or broken images", async (t) => {
  const result = await migrate(t, { body: '[vc_row][vc_column][vc_single_image][vc_single_image image="not-an-id"][/vc_column][/vc_row]' });
  assert.equal(mediaRequests(result).length, 0);
  assert.equal(downloadRequests(result).length, 0);
  assert.doesNotMatch(result.output, /<img|\[\/?vc_/);
  assert.match(result.output, /wp-media-unresolved/);
  assert.equal(imageDiagnostics(result)[0].count, 2);
  assert.match(imageDiagnostics(result)[0].reason, /missing-or-invalid-attachment-id/);
  assert.equal(coverage(result).overallStatus, "manual-review");
});

for (const [name, options, reason] of [
  ["missing record", { lookupStatus: 404 }, "lookup-failed"],
  ["inaccessible record", { lookupStatus: 401 }, "lookup-failed"],
  ["failed lookup", { lookupThrows: true }, "lookup-failed"],
  ["mismatched ID", { record: { ...MEDIA_RECORD, id: 456 } }, "record-missing-or-invalid"],
  ["unsupported media", { record: { ...MEDIA_RECORD, mime_type: "application/pdf" } }, "unsupported-media-type"],
  ["unsafe source URL", { record: { ...MEDIA_RECORD, source_url: "javascript:alert(1)" } }, "unsupported-media-url"],
  ["failed download", { downloadStatus: 503 }, "download-failed"],
  ["HTML login response", { downloadMime: "text/html" }, "download-failed"],
  ["empty download", { emptyDownload: true }, "download-failed"]
]) {
  test(`${name}: preserve explicit attachment diagnostics without an img`, async (t) => {
    const result = await migrate(t, options);
    assert.doesNotMatch(result.output, /<img|\[\/?vc_/);
    assert.match(result.output, /data-media-unresolved-id="123"/);
    assert.match(result.output, /Everyone is welcome\./);
    assert.equal(imageDiagnostics(result)[0].attachmentId, 123);
    assert.match(imageDiagnostics(result)[0].reason, new RegExp(reason));
    assert.equal(coverage(result).overallStatus, "manual-review");
    assert.ok(!coverage(result).handledUnits.some((unit) => unit.unit === "vc_single_image"));
    assert.doesNotMatch(JSON.stringify(result.report), /offline-test-token/);
    await assert.rejects(fs.access(path.join(result.root, "media/wp-content/uploads/2021/09/event.png")));
  });
}

for (const [config, reason] of [[{ downloadMedia: false }, "downloads-disabled"], [{ dryRun: true }, "dry-run"]]) {
  test(`${reason}: do not claim media is available or perform attachment I/O`, async (t) => {
    const result = await migrate(t, { config });
    assert.equal(mediaRequests(result).length, 0);
    assert.equal(downloadRequests(result).length, 0);
    assert.match(imageDiagnostics(result)[0].reason, new RegExp(reason));
    assert.doesNotMatch(result.output, /<img/);
  });
}

test("authoritative CDN source uses local media and receives no WordPress credentials", async (t) => {
  const result = await migrate(t, { record: { ...MEDIA_RECORD, source_url: MEDIA_RECORD.source_url.replace("wordpress.example", "cdn.example") } });
  assert.equal(downloadRequests(result)[0].authorization, undefined);
  assert.match(result.output, /src="\/media\/_external\/cdn.example\/wp-content\/uploads\/2021\/09\/event.png"/);
  assert.deepEqual(await fs.readFile(path.join(result.root, "media/_external/cdn.example/wp-content/uploads/2021/09/event.png")), IMAGE_BYTES);
});

test("sanitized local URL matches the downloaded filename", async (t) => {
  const result = await migrate(t, { record: { ...MEDIA_RECORD, source_url: MEDIA_RECORD.source_url.replace("event.png", "event%20photo.png") } });
  assert.match(result.output, /src="\/media\/wp-content\/uploads\/2021\/09\/event_20photo.png"/);
  assert.deepEqual(await fs.readFile(path.join(result.root, "media/wp-content/uploads/2021/09/event_20photo.png")), IMAGE_BYTES);
});

test("transformer dependency is synchronous, metadata is escaped, and unresolved IDs stay distinct", () => {
  const context = {
    resolveMediaById: (id) => id === 123 ? { url: '/media/event.png', alt: 'A "quote" & detail', caption: '<script>bad()</script><p>Good &lt;img src=x&gt;</p>' } : null,
    unresolvedMediaReason: (id) => id === 456 ? "lookup-failed" : "download-failed"
  };
  const source = MEDIA_BODY + '[vc_single_image image="456"][vc_single_image image="789"]';
  const result = transformWpBakery(source, context);
  assert.match(result.output, /alt="A &quot;quote&quot; &amp; detail"/);
  assert.match(result.output, /<figcaption>Good &lt;img src=x&gt;<\/figcaption>/);
  assert.doesNotMatch(result.output, /bad\(\)|<script|\[\/?vc_/);
  assert.deepEqual(result.plan.unhandledUnits.map((unit) => unit.attachmentId), [456, 789]);
  assert.match(result.plan.unhandledUnits[0].reason, /lookup-failed/);
  assert.match(result.plan.unhandledUnits[1].reason, /download-failed/);
  const doc = itemToDoc({ content: { rendered: source } }, "posts", { htmlMode: "basic-markdown" }, new Map(), new Map(), [], context);
  assert.match(doc.body, /<figcaption>Good &lt;img src=x&gt;<\/figcaption>/);
});

test("media discovery follows the shortcode AST and ignores escaped, invalid, and unrelated IDs", () => {
  assert.deepEqual(collectWpBakeryMediaIds(MEDIA_BODY + '[vc_single_image image="123"][[vc_single_image image="456"]][gallery ids="789"][vc_single_image image="0"]'), [123]);
});
