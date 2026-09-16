import { test } from "node:test";
import assert from "node:assert/strict";

import { transformWpBakery, handlesUnit } from "../src/blocks/page-builders/wpbakery.mjs";
import {
  JUHLAPAIVA_SHAPED,
  WRAPPERS_ONLY,
  VIDEO_NON_YOUTUBE,
  HEADING_WITH_ENTITIES,
  UNKNOWN_VCEX,
  SINGLE_IMAGE_ID_ONLY
} from "./fixtures/wpbakery-content/samples.mjs";

// Invariant that every test enforces: after the transformer runs,
// none of the WPBakery shortcode tokens listed by the user must
// remain visibly in the output. This helper checks the full set at
// once so no test path can accidentally allow a leak.
const FORBIDDEN_VISIBLE_TOKENS = [
  "[vc_row]",
  "[vc_row ",
  "[vc_column]",
  "[vc_column ",
  "[vc_column_text]",
  "[vc_column_text ",
  "[vc_row_inner",
  "[vc_column_inner",
  "[vc_column_text/]",
  "[vc_video ",
  "[vc_video]",
  "[vc_empty_space",
  "[vc_custom_heading",
  "[vc_single_image",
  "[/vc_row",
  "[/vc_column",
  "[/vc_column_text",
  "[/vc_video",
  "[/vc_column_inner",
  "[/vc_row_inner"
];

function assertNoRawShortcodesVisible(out, ctx = "") {
  for (const tok of FORBIDDEN_VISIBLE_TOKENS) {
    assert.ok(
      !out.includes(tok),
      `${ctx}: output contained forbidden raw shortcode token "${tok}". Got:\n${out}`
    );
  }
}

test("handlesUnit reports coverage for structural wrappers and known leaves", () => {
  for (const name of [
    "vc_row",
    "vc_column",
    "vc_row_inner",
    "vc_column_inner",
    "vc_column_text",
    "vc_empty_space",
    "vc_custom_heading",
    "vc_single_image",
    "vc_video"
  ]) {
    assert.equal(handlesUnit(name), true, `${name} should be handled`);
  }
  for (const name of ["vcex_button", "rev_slider", "contact-form-7", "unknown_widget"]) {
    assert.equal(handlesUnit(name), false, `${name} should NOT be reported as handled`);
  }
});

test("Juhlapäivä-shaped fixture: produces readable HTML with no raw WPBakery tokens", () => {
  const { output, plan } = transformWpBakery(JUHLAPAIVA_SHAPED);
  assertNoRawShortcodesVisible(output, "Juhlapäivä");
  // Heading text should surface as an <h2> (or valid h1-h6) with the
  // decoded text. `font_container: tag:h2` → <h2>.
  assert.match(output, /<h2>Kutsu tapahtumaan<\/h2>/);
  // Column-text HTML survives untouched (structural wrappers dropped).
  assert.match(output, /<p>Tervetuloa juhlaan lauantaina\.<\/p>/);
  assert.match(output, /<strong>Ohjelma alkaa<\/strong>/);
  // Empty-space renders as a semantic spacer, not `[vc_empty_space]`.
  assert.match(output, /<div class="wp-empty-space"[^>]*><\/div>/);
  // YouTube link → responsive embed.
  assert.match(
    output,
    /<div class="wp-video-embed"><iframe src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/
  );
  // Attachment-ID image → placeholder figure with data-media-unresolved-id.
  assert.match(output, /<figure class="wp-media-unresolved"[^>]*data-media-unresolved-id="2658"/);
  // Plan reports the handled families with counts, and vc_single_image as unhandled.
  const handledNames = plan.handledUnits.map((h) => h.unit).sort();
  for (const expected of ["vc_row", "vc_column", "vc_column_text", "vc_custom_heading", "vc_empty_space", "vc_video"]) {
    assert.ok(handledNames.includes(expected), `handledUnits missing ${expected}`);
  }
  const unresolvedImage = plan.unhandledUnits.find((u) => u.unit === "vc_single_image");
  assert.ok(unresolvedImage, "vc_single_image must appear as unhandled");
  assert.equal(unresolvedImage.criticality, "manual-review");
  assert.match(unresolvedImage.reason, /attachment #2658/i);
});

test("Wrappers-only fixture: structural shortcodes vanish, inner HTML is preserved verbatim", () => {
  const { output, plan } = transformWpBakery(WRAPPERS_ONLY);
  assertNoRawShortcodesVisible(output, "WRAPPERS_ONLY");
  assert.match(output, /<p>Body paragraph one\.<\/p>/);
  assert.match(output, /<p>Body paragraph two\.<\/p>/);
  // No unresolved units.
  assert.equal(plan.unhandledUnits.length, 0);
  // vc_row, vc_column, vc_column_text each handled exactly once.
  const map = new Map(plan.handledUnits.map((h) => [h.unit, h.count]));
  assert.equal(map.get("vc_row"), 1);
  assert.equal(map.get("vc_column"), 1);
  assert.equal(map.get("vc_column_text"), 1);
});

test("vc_video with a non-YouTube link falls back to a clickable link, no raw shortcode", () => {
  const { output, plan } = transformWpBakery(VIDEO_NON_YOUTUBE);
  assertNoRawShortcodesVisible(output, "VIDEO_NON_YOUTUBE");
  // No iframe (non-YouTube).
  assert.doesNotMatch(output, /<iframe/);
  // Clickable link with the original URL text visible.
  assert.match(output, /<a href="https:\/\/vimeo\.com\/12345678"[^>]*>https:\/\/vimeo\.com\/12345678<\/a>/);
  // Video still counted as handled.
  const handled = plan.handledUnits.find((h) => h.unit === "vc_video");
  assert.ok(handled, "vc_video handled entry");
  assert.equal(handled.count, 1);
});

test("vc_custom_heading decodes entities and honours the tag from font_container", () => {
  const { output } = transformWpBakery(HEADING_WITH_ENTITIES);
  assertNoRawShortcodesVisible(output, "HEADING_WITH_ENTITIES");
  // `tag:h3` → <h3>; entities decoded to natural text.
  assert.match(output, /<h3>Kysymyksiä &amp; vastauksia<\/h3>/);
});

test("Unknown WPBakery/Total shortcode surfaces as an HTML comment, not raw syntax", () => {
  const { output, plan } = transformWpBakery(UNKNOWN_VCEX);
  assertNoRawShortcodesVisible(output, "UNKNOWN_VCEX");
  // Also guard the specific vcex_ token — the forbidden list already
  // covers all vc_* forms, but vcex_ needs its own check.
  assert.ok(
    !output.includes("[vcex_button"),
    `output must not leak raw vcex_button; got:\n${output}`
  );
  // Comment marker present.
  assert.match(output, /<!-- wpbakery-unhandled: vcex_button -->/);
  // Downstream content (body paragraph after the button) survives.
  assert.match(output, /<p>Body after button\.<\/p>/);
  // Plan diagnostic present.
  const btn = plan.unhandledUnits.find((u) => u.unit === "vcex_button");
  assert.ok(btn, "vcex_button must appear as unhandled");
  assert.equal(btn.criticality, "manual-review");
});

test("vc_single_image with only an image ID never invents a URL", () => {
  const { output, plan } = transformWpBakery(SINGLE_IMAGE_ID_ONLY);
  assertNoRawShortcodesVisible(output, "SINGLE_IMAGE_ID_ONLY");
  // No <img> tag — we must not fabricate a URL from the attachment ID.
  assert.doesNotMatch(output, /<img\s/i);
  // Placeholder figure with the ID surfaced as a data attribute.
  assert.match(output, /<figure class="wp-media-unresolved"[^>]*data-media-unresolved-id="42"/);
  // Plan surfaces the manual-review diagnostic.
  const entry = plan.unhandledUnits.find((u) => u.unit === "vc_single_image");
  assert.ok(entry, "vc_single_image must appear as unhandled");
  assert.equal(entry.criticality, "manual-review");
  assert.match(entry.reason, /attachment #42/);
});

test("Empty and shortcode-free content are passed through unchanged", () => {
  const empty = transformWpBakery("");
  assert.equal(empty.output, "");
  assert.equal(empty.plan.handledUnits.length, 0);
  assert.equal(empty.plan.unhandledUnits.length, 0);

  const plain = transformWpBakery(`<p>Hello, world.</p>\n<p>Two paragraphs.</p>`);
  assert.equal(plain.output, `<p>Hello, world.</p>\n<p>Two paragraphs.</p>`);
  assert.equal(plain.plan.handledUnits.length, 0);
  assert.equal(plain.plan.unhandledUnits.length, 0);
});

test("Deeply nested wrappers still preserve inner content and drop every wrapper", () => {
  const src = `[vc_row][vc_column][vc_row_inner][vc_column_inner][vc_column_text]<p>Deep body.</p>[/vc_column_text][/vc_column_inner][/vc_row_inner][/vc_column][/vc_row]`;
  const { output, plan } = transformWpBakery(src);
  assertNoRawShortcodesVisible(output, "deep-nested");
  assert.equal(output.trim(), `<p>Deep body.</p>`);
  const handledMap = new Map(plan.handledUnits.map((h) => [h.unit, h.count]));
  assert.equal(handledMap.get("vc_row"), 1);
  assert.equal(handledMap.get("vc_column"), 1);
  assert.equal(handledMap.get("vc_row_inner"), 1);
  assert.equal(handledMap.get("vc_column_inner"), 1);
  assert.equal(handledMap.get("vc_column_text"), 1);
});
