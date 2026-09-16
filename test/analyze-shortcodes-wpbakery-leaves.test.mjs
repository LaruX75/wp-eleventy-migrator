import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAnalyze } from "../src/app/analyze.mjs";
import {
  VC_EMPTY_SPACE_NO_TERM,
  VC_CUSTOM_HEADING_NO_TERM,
  VC_SINGLE_IMAGE_NO_TERM,
  VC_VIDEO_NO_TERM,
  WPBAKERY_LEAVES_ALL_NO_TERM
} from "./fixtures/analyze-preflight-shortcodes/content-samples.mjs";

// Regression tests for WPBakery leaf shortcodes written WITHOUT a
// trailing `/` terminator. Before this fix the generic parser
// classified them as `malformed-shortcode` because they were paired
// openers without a `[/name]` closer. Real WordPress content
// (e.g. jaali.eu) uses this form authoritatively. Correct behaviour:
// they parse as valid self-closing units, appear in
// `documents[].shortcodes`, and classify as unhandled manual-review
// units with preserved source and source spans — never as
// `malformed-shortcode`.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WXR_PATH = path.join(__dirname, "fixtures", "analyze-preflight-shortcodes", "wxr.xml");

function startMockRestServer(pageItems) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1/");
      const send = (body) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "X-WP-Total": String(Array.isArray(body) ? body.length : 0),
          "X-WP-TotalPages": "1"
        });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/wp-json/wp/v2/categories") return send([]);
      if (url.pathname === "/wp-json/wp/v2/tags") return send([]);
      if (url.pathname === "/wp-json/wp/v2/pages") return send(pageItems);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function analyzeSingleContent(t, { slug, content }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpe-vc-leaf-"));
  const analysisOutputDir = path.join(tmpDir, "analysis-out");
  await fs.mkdir(analysisOutputDir, { recursive: true });
  const items = [
    {
      id: 1,
      slug,
      date: "2024-05-01T09:00:00",
      link: `http://127.0.0.1/${slug}/`,
      title: { rendered: slug },
      content: { rendered: content, raw: content }
    }
  ];
  const { server, port } = await startMockRestServer(items);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const configPath = path.join(tmpDir, "config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        preset: "none",
        sourceType: "rest",
        wpBaseUrl: `http://127.0.0.1:${port}`,
        restNamespace: "/wp-json/wp/v2",
        contentTypes: "pages",
        authMode: "none",
        xmlBackupPath: WXR_PATH,
        analysisOutputDir
      },
      null,
      2
    ),
    "utf8"
  );

  const { writePlanPath } = await runAnalyze(configPath, { skipXmlBackup: false });
  const plan = JSON.parse(await fs.readFile(writePlanPath, "utf8"));
  return plan.documents[0];
}

// Data-driven case set — one test per exact fixture form the user
// called out (each leaf shortcode WITHOUT trailing ` /`).
const LEAF_CASES = [
  { name: "vc_empty_space", content: VC_EMPTY_SPACE_NO_TERM, sourceMatch: /vc_empty_space/ },
  { name: "vc_custom_heading", content: VC_CUSTOM_HEADING_NO_TERM, sourceMatch: /vc_custom_heading/ },
  { name: "vc_single_image", content: VC_SINGLE_IMAGE_NO_TERM, sourceMatch: /vc_single_image/ },
  { name: "vc_video", content: VC_VIDEO_NO_TERM, sourceMatch: /vc_video/ }
];

for (const c of LEAF_CASES) {
  test(`WPBakery leaf regression: [${c.name}] without / is parsed as self-closing, not malformed`, async (t) => {
    const doc = await analyzeSingleContent(t, { slug: c.name, content: c.content });

    // The shortcode surfaces on the per-document list at count 1.
    const entry = doc.shortcodes.find((s) => s.name === c.name);
    assert.ok(entry, `${c.name} must appear in documents[].shortcodes; got ${JSON.stringify(doc.shortcodes)}`);
    assert.equal(entry.count, 1);

    // No malformed-shortcode entry may appear for this doc — the whole
    // point of the fix is that this input is syntactically valid.
    const malformed = doc.transformerPlan.unhandledUnits.find(
      (u) => u.unit === "malformed-shortcode"
    );
    assert.equal(
      malformed,
      undefined,
      `${c.name} must NOT be flagged malformed-shortcode. Got: ${JSON.stringify(doc.transformerPlan.unhandledUnits)}`
    );

    // Classification is unhandled + manual-review (no transformer registered).
    const unhandled = doc.transformerPlan.unhandledUnits.find((u) => u.unit === c.name);
    assert.ok(unhandled, `${c.name} must appear in transformerPlan.unhandledUnits`);
    assert.equal(unhandled.criticality, "manual-review");
    assert.equal(unhandled.count, 1);

    // Preserved source unit exists with a non-zero byte span (source
    // spans back the preserved bytes).
    const preserved = doc.transformerPlan.preservedSourceUnits.find((p) => p.unit === c.name);
    assert.ok(preserved, `${c.name} must appear in preservedSourceUnits`);
    assert.ok(preserved.bytes > 0, `${c.name} preserved-source bytes must be > 0`);
    // Byte count must at least cover the shortcode's opening tag length,
    // proving the parser retained the source region and did not
    // collapse it.
    assert.ok(
      preserved.bytes >= `[${c.name}]`.length,
      `${c.name} preserved bytes ${preserved.bytes} smaller than opening-tag length`
    );

    // overallStatus rolls up to manual-review for a doc containing
    // only one manual-review unit.
    assert.equal(doc.transformerPlan.overallStatus, "manual-review");
  });
}

test("WPBakery leaf regression: all four leaves in one document → all classified as manual-review, none malformed", async (t) => {
  const doc = await analyzeSingleContent(t, {
    slug: "all-leaves",
    content: WPBAKERY_LEAVES_ALL_NO_TERM
  });

  // All four leaf names appear in the per-document shortcode list.
  const names = doc.shortcodes.map((s) => s.name).sort();
  assert.deepEqual(
    names.filter((n) => n.startsWith("vc_")),
    ["vc_custom_heading", "vc_empty_space", "vc_single_image", "vc_video"]
  );

  // None of the four end up as malformed-shortcode.
  const malformed = doc.transformerPlan.unhandledUnits.find(
    (u) => u.unit === "malformed-shortcode"
  );
  assert.equal(
    malformed,
    undefined,
    `No leaf should be malformed. Got: ${JSON.stringify(doc.transformerPlan.unhandledUnits)}`
  );

  // Each of the four appears with criticality manual-review.
  for (const leaf of ["vc_empty_space", "vc_custom_heading", "vc_single_image", "vc_video"]) {
    const u = doc.transformerPlan.unhandledUnits.find((x) => x.unit === leaf);
    assert.ok(u, `${leaf} must be in unhandledUnits`);
    assert.equal(u.criticality, "manual-review", `${leaf} must be manual-review`);
  }

  // Overall document rolls up to manual-review (no blocking present).
  assert.equal(doc.transformerPlan.overallStatus, "manual-review");
});

test("WPBakery leaf regression: row/column pairs remain unchanged after the leaf fix", async (t) => {
  // Guard against the regression in the other direction: after
  // registering the four leaves as self-closing, row/column pairs
  // (which are NOT self-closing) must still surface as unhandled
  // manual-review units with proper source spans, not accidentally
  // become malformed or flatten out.
  const doc = await analyzeSingleContent(t, {
    slug: "row-column-guard",
    content: `[vc_row][vc_column][vc_column_text]Hi[/vc_column_text][/vc_column][/vc_row]`
  });

  // vc_row / vc_column / vc_column_text all recorded at least once.
  const found = new Map(doc.shortcodes.map((s) => [s.name, s.count]));
  assert.equal(found.get("vc_row"), 1);
  assert.equal(found.get("vc_column"), 1);
  assert.equal(found.get("vc_column_text"), 1);

  // None malformed.
  const malformed = doc.transformerPlan.unhandledUnits.find(
    (u) => u.unit === "malformed-shortcode"
  );
  assert.equal(malformed, undefined);

  // All three classify as manual-review (no transformer yet).
  for (const name of ["vc_row", "vc_column", "vc_column_text"]) {
    const u = doc.transformerPlan.unhandledUnits.find((x) => x.unit === name);
    assert.ok(u, `${name} must be in unhandledUnits`);
    assert.equal(u.criticality, "manual-review", `${name} must remain manual-review`);
  }
});
