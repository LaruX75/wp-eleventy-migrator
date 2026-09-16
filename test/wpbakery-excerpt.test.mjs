import { test } from "node:test";
import assert from "node:assert/strict";

import { itemToDoc } from "../scripts/wp-eleventy-migrate.mjs";
import { JUHLAPAIVA_SHAPED, JUHLAPAIVA_AUTO_EXCERPT } from "./fixtures/wpbakery-content/samples.mjs";

function migrate(excerpt, htmlMode = "keep-html") {
  return itemToDoc({
    id: 2484,
    title: { rendered: "Juhlapäivä 2021" },
    content: { rendered: JUHLAPAIVA_SHAPED },
    excerpt
  }, "posts", { htmlMode }, new Map(), new Map(), []);
}

const EVENT_TEXT = "Tervetuloa juhlaan lauantaina. Ohjelmassa musiikkia, torikahvit ja lapsille pomppulinna.";

for (const htmlMode of ["keep-html", "basic-markdown"]) {
  for (const shape of ["rendered", "string"]) {
    test(`migration: WPBakery ${shape} excerpt is plain text (${htmlMode})`, () => {
      const source = shape === "rendered" ? { rendered: JUHLAPAIVA_AUTO_EXCERPT } : JUHLAPAIVA_AUTO_EXCERPT;
      const doc = migrate(source, htmlMode);
      assert.doesNotMatch(doc.body, /\[\/?vc_/);
      assert.match(doc.body, /Tervetuloa juhlaan lauantaina\./);
      assert.equal(doc.frontMatter.excerpt, EVENT_TEXT);
      assert.doesNotMatch(doc.frontMatter.excerpt, /\[\/?vc_|<!--|-->|<iframe|<figure|wp-media-unresolved|data-media-unresolved-id/);
    });
  }
}

test("migration: truncated excerpt with unclosed WPBakery wrappers retains text", () => {
  const doc = migrate({ rendered: '<p>[vc_row content_placement=”middle”][vc_column][vc_video link=”https://youtu.be/dQw4w9WgXcQ” align=”center”][/vc_column][/vc_row][vc_row][vc_column][vc_column_text]Tervetuloa juhlaan lauantaina. Ohjelma alkaa&#8230;</p>' });
  assert.equal(doc.frontMatter.excerpt, "Tervetuloa juhlaan lauantaina. Ohjelma alkaa…");
});

test("migration: WPBakery excerpt removes entire HTML comments including embedded >", () => {
  const doc = migrate('[vc_column_text]<p>Event <!-- private > comment --> text.</p>[/vc_column_text]');
  assert.equal(doc.frontMatter.excerpt, "Event text.");
});

test("migration: excerpts without WPBakery preserve existing behavior", () => {
  for (const [source, expected] of [
    ["<p>Manual <strong>excerpt</strong> &amp; details.</p>", "Manual excerpt & details."],
    ['<p>[gallery ids="1,2"] Useful text.</p>', '[gallery ids="1,2"] Useful text.'],
    ["<p>[note] and [vc] remain literal.</p>", "[note] and [vc] remain literal."],
    ["", ""]
  ]) {
    for (const value of [source, { rendered: source }]) {
      assert.equal(migrate(value).frontMatter.excerpt, expected);
    }
  }
  assert.equal(migrate(undefined).frontMatter.excerpt, "");
});
