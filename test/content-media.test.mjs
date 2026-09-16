import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMigration } from "../scripts/wp-eleventy-migrate.mjs";
import { createConfigFromInput } from "../src/config/normalize.mjs";
import { localiseContentImages, inspectContentImages } from "../src/media/content-images.mjs";
import { ORIGIN, FULL, SMALL, RECORD, HTML } from "./fixtures/content-media/samples.mjs";
import { IMAGE_BYTES } from "./fixtures/wpbakery-content/media.mjs";

async function migrate(t, { html = HTML, library = [RECORD], lookupFails = false, failUrl = "", mime = "image/png", config: overrides = {}, embedded, extraPages = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-content-media-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [];
  t.mock.method(globalThis, "fetch", async (value, init = {}) => {
    const url = new URL(value);
    requests.push({ url: url.href, authorization: init.headers?.Authorization });
    if (/\/(categories|tags)$/.test(url.pathname)) return Response.json([]);
    if (url.pathname.endsWith("/posts")) return Response.json([{
      id: 1, slug: "event", date: "2021-09-07T12:00:00", status: "publish", link: `${ORIGIN}/news/event/`,
      content: { rendered: html }, excerpt: { rendered: "Event excerpt" },
      ...(embedded ? { _embedded: { "wp:featuredmedia": [embedded] } } : {})
    }], { headers: { "X-WP-TotalPages": "1" } });
    if (url.pathname.endsWith("/media")) {
      if (lookupFails) return new Response("offline-secret", { status: 403 });
      const page = Number(url.searchParams.get("page") || 1);
      return Response.json(page === 1 ? library : extraPages[page - 2] || [], { headers: { "X-WP-TotalPages": String(1 + extraPages.length) } });
    }
    if (url.pathname.endsWith("/media/123")) return Response.json(RECORD);
    if (url.origin === ORIGIN && url.pathname.startsWith("/wp-content/")) {
      return new Response(IMAGE_BYTES, { status: value === failUrl ? 503 : 200, headers: { "Content-Type": mime } });
    }
    throw new Error(`Unexpected request to ${url.origin}${url.pathname}`);
  });
  const config = await createConfigFromInput({
    wpBaseUrl: ORIGIN, siteMode: "existing", outputRoot: root, contentTypes: "posts",
    downloadMedia: true, dryRun: false, createRedirects: false, importMenus: false,
    authMode: "app-password", wpUser: "offline-user", wpAppPassword: "offline-secret", ...overrides
  });
  const report = await runMigration(null, config);
  const output = config.dryRun ? "" : await fs.readFile(path.join(root, "content/posts/2021-09-07-event.md"), "utf8");
  return { root, report, output, requests };
}
const mediaRequests = (result) => result.requests.filter(({ url }) => new URL(url).pathname.includes("/media"));
const downloads = (result) => result.requests.filter(({ url }) => new URL(url).pathname.startsWith("/wp-content/"));
const references = (result) => result.report.actionItems.contentMedia.flatMap((doc) => doc.references);
const local = (url) => `/media${new URL(url).pathname}`;

for (const htmlMode of ["keep-html", "basic-markdown"]) {
  test(`ordinary images, linked originals, srcset and captions survive (${htmlMode})`, async (t) => {
    const result = await migrate(t, { config: { htmlMode } });
    const expected = HTML.replaceAll(FULL, local(FULL)).replaceAll(SMALL, local(SMALL)).replace("src='/wp-content", "src='/media/wp-content");
    assert.ok(result.output.includes(expected), result.output);
    assert.equal(downloads(result).length, 2);
    assert.equal(mediaRequests(result).length, 1);
    assert.match(mediaRequests(result)[0].authorization, /^Basic /);
    assert.ok(downloads(result).every((r) => r.authorization === mediaRequests(result)[0].authorization));
    for (const url of [FULL, SMALL]) assert.deepEqual(await fs.readFile(path.join(result.root, local(url))), IMAGE_BYTES);
    assert.ok(references(result).every((ref) => ref.status === "localised"));
    assert.doesNotMatch(JSON.stringify(result.report), /offline-secret|Basic /);
  });
}

test("WPBakery ID and ordinary HTML images share their confirmed mapping and download", async (t) => {
  const result = await migrate(t, { html: `[vc_row][vc_column][vc_single_image image="123"][vc_column_text]<img src="${FULL}" alt="Original alt"><p>Body text.</p>[/vc_column_text][/vc_column][/vc_row]` });
  assert.equal(downloads(result).length, 1);
  assert.equal(mediaRequests(result).length, 1); // /media/123 only, no library scan
  assert.doesNotMatch(result.output, /\[\/?vc_|wp-media-unresolved/);
  assert.equal((result.output.match(new RegExp(`src="${local(FULL)}"`, "g")) || []).length, 2);
  assert.match(result.output, /alt="Original alt"/);
  assert.equal(result.report.transformerCoverage.documents[0].handledUnits.find((u) => u.unit === "vc_single_image").count, 1);
});

test("embedded media record is sufficient URL evidence without a library request", async (t) => {
  const result = await migrate(t, { html: `<img src="${SMALL}">`, embedded: RECORD });
  assert.equal(mediaRequests(result).length, 0);
  assert.match(result.output, /src="\/media\/wp-content\/uploads\/2021\/event-300x200.png"/);
});

test("relative and protocol-relative URLs and lazy attributes localise without changing metadata", async (t) => {
  const html = `<img src="//wordpress.example/wp-content/uploads/2021/event.png" data-src="../../wp-content/uploads/2021/event-300x200.png" data-srcset="${SMALL} 1x, ${FULL} 2x" title="Keep > this" alt='A &quot;quote&quot;'>`;
  const result = await migrate(t, { html });
  assert.match(result.output, /data-src="\/media\/wp-content\/uploads\/2021\/event-300x200.png"/);
  assert.match(result.output, /data-srcset="\/media\/wp-content\/uploads\/2021\/event-300x200.png 1x, \/media\/wp-content\/uploads\/2021\/event.png 2x"/);
  assert.match(result.output, /title="Keep > this" alt='A &quot;quote&quot;'/);
});

test("unverified same-origin URLs and nonexistent size variants are never guessed or downloaded", async (t) => {
  const html = `<img class="wp-image-123" src="${ORIGIN}/wp-content/uploads/2021/event-99x99.png"><img src="${ORIGIN}/wp-content/unknown.png">`;
  const result = await migrate(t, { html });
  assert.ok(result.output.includes(html));
  assert.equal(downloads(result).length, 0);
  assert.ok(references(result).every((ref) => ref.reason === "unverified-media-url" && ref.status === "retained"));
});

test("external images and lookalike hosts remain byte-for-byte unchanged without network requests", async (t) => {
  const html = '<a href="https://cdn.example/full.png"><img src="https://wordpress.example.evil/image.png" srcset="https://cdn.example/small.png 1x, https://cdn.example/full.png 2x"></a>';
  const result = await migrate(t, { html });
  assert.ok(result.output.includes(html));
  assert.equal(mediaRequests(result).length, 0);
  assert.equal(downloads(result).length, 0);
  assert.ok(references(result).every((ref) => ref.reason === "external-media"));
});

for (const [name, options, reason] of [
  ["failed library lookup", { lookupFails: true }, "media-library-lookup-failed"],
  ["failed image download", { failUrl: FULL }, "download-failed"],
  ["wrong download MIME", { mime: "text/html" }, "download-failed"],
  ["disabled downloads", { config: { downloadMedia: false } }, "downloads-disabled"],
  ["dry run", { config: { dryRun: true } }, "dry-run"]
]) {
  test(`${name}: retain source and report reason`, async (t) => {
    const html = `<a href="${FULL}"><img src="${FULL}" alt="Keep me"></a>`;
    const result = await migrate(t, { ...options, html });
    if (!options.config?.dryRun) assert.ok(result.output.includes(html));
    assert.ok(references(result).every((ref) => ref.reason === reason && ref.status === "retained"));
    await assert.rejects(fs.access(path.join(result.root, local(FULL))));
    assert.doesNotMatch(JSON.stringify(result.report), /offline-secret/);
  });
}

test("srcset can retain a failed candidate while localising verified alternatives", async (t) => {
  const result = await migrate(t, { html: `<img src="${FULL}" srcset="${SMALL} 300w, ${FULL} 1200w">`, failUrl: SMALL });
  assert.match(result.output, /src="\/media\/wp-content\/uploads\/2021\/event.png"/);
  assert.ok(result.output.includes(`srcset="${SMALL} 300w, ${local(FULL)} 1200w"`));
  assert.equal(downloads(result).length, 2); // failure is not retried by the legacy downloader
});

test("media collection is paginated and fetched only once for multiple references", async (t) => {
  const second = `${ORIGIN}/wp-content/second.png`;
  const result = await migrate(t, { html: `<img src="${FULL}"><img src="${second}">`, extraPages: [[{ id: 456, source_url: second, mime_type: "image/png" }]] });
  assert.equal(mediaRequests(result).length, 2);
  assert.ok(result.output.includes(`src="${local(second)}"`));
});

test("non-image media keeps its existing migration path", async (t) => {
  const result = await migrate(t, { html: `<video src="${ORIGIN}/wp-content/clip.mp4"></video><p>No images.</p>` });
  assert.match(result.output, /src="\/media\/wp-content\/clip.mp4"/);
  assert.equal(mediaRequests(result).length, 0);
  assert.equal(downloads(result).length, 1);
});

test("source-preserving scanner ignores raw text and comments, and handles attribute quoting", async () => {
  const html = `<!-- <img src="${FULL}"> --><script>const x = '<img src="${FULL}">';</script><textarea><img src="${FULL}"></textarea><IMG SRC=${FULL} ALT='a > b'><a href="/news/page">Page link</a>`;
  const found = inspectContentImages(html);
  assert.equal(found.references.length, 1);
  const result = await localiseContentImages(html, { baseUrl: ORIGIN, resolver: {
    prepareUrls: async (urls) => assert.deepEqual(urls, [FULL]),
    resolveMediaUrl: () => local(FULL), isLocalMediaUrl: () => false
  } });
  assert.equal(result.output, html.replace(`<IMG SRC=${FULL}`, `<IMG SRC=${local(FULL)}`));
});

test("unsupported srcset and sensitive external URLs stay unchanged and diagnostics omit secrets", async (t) => {
  const html = `<img src="https://user:password@cdn.example/photo.png?token=secret" srcset="data:image/png;base64,abc 1x, ${FULL} 2x">`;
  const result = await migrate(t, { html });
  assert.ok(result.output.includes(html));
  assert.equal(downloads(result).length, 0);
  assert.equal(mediaRequests(result).length, 0);
  assert.doesNotMatch(JSON.stringify(result.report.actionItems.contentMedia), /password|token=|secret/);
  assert.ok(references(result).some((ref) => ref.reason === "unsupported-srcset"));
});


test("a failed content image reused as featured media is not retried or blindly rewritten", async (t) => {
  const html = `<img src="${FULL}">`;
  const result = await migrate(t, { html, embedded: RECORD, failUrl: FULL });
  assert.ok(result.output.includes(html));
  assert.ok(result.output.includes(`featuredImage: "${FULL}"`));
  assert.equal(downloads(result).length, 1);
  assert.equal(references(result)[0].reason, "download-failed");
});

test("query strings must match media evidence exactly and encoded attributes remain valid", async (t) => {
  const signed = FULL + "?version=1&format=png";
  const result = await migrate(t, {
    html: `<img src="${FULL}?version=1&amp;format=png"><img src="${FULL}?version=2&amp;format=png">`,
    library: [{ ...RECORD, source_url: signed, media_details: {} }]
  });
  assert.ok(result.output.includes(`<img src="${local(FULL)}">`));
  assert.ok(result.output.includes(`<img src="${FULL}?version=2&amp;format=png">`));
  assert.equal(downloads(result).length, 1);
  assert.equal(downloads(result)[0].url, signed);
});
