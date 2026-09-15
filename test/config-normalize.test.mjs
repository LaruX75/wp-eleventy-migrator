import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createConfigFromInput,
  parseCsvList,
  nowStamp,
  resolveOutputRoot,
  normalizeEleventyReplacements
} from "../src/config/normalize.mjs";
import {
  DEFAULT_TYPES,
  DEFAULT_NAMESPACE,
  DEFAULT_KADENCE_BLOCKS_DIR,
  DEFAULT_STYLES_DIR,
  DEFAULT_KADENCE_STYLES_DIR,
  DEFAULT_KADENCE_PRO_STYLES_DIR
} from "../src/config/defaults.mjs";

test("createConfigFromInput with empty input yields defaults", async () => {
  const cfg = await createConfigFromInput({});
  assert.equal(cfg.preset, "none");
  assert.equal(cfg.authMode, "none");
  assert.equal(cfg.htmlMode, "keep-html");
  assert.equal(cfg.sourceType, "rest");
  assert.equal(cfg.restNamespace, DEFAULT_NAMESPACE);
  assert.deepEqual(cfg.contentTypes, [...DEFAULT_TYPES]);
  assert.equal(cfg.stylesDir, DEFAULT_STYLES_DIR);
  assert.equal(cfg.kadenceBlocksDir, DEFAULT_KADENCE_BLOCKS_DIR);
  assert.equal(cfg.dryRun, true);
  assert.equal(cfg.useNunjucksLayouts, false);
  assert.equal(cfg.convertKadenceBlocks, false);
  assert.equal(cfg.migrateStyles, false);
});

test("createConfigFromInput applies kadence preset defaults", async () => {
  const cfg = await createConfigFromInput({ preset: "kadence" });
  assert.equal(cfg.preset, "kadence");
  assert.equal(cfg.useNunjucksLayouts, true);
  assert.equal(cfg.convertKadenceBlocks, true);
  assert.equal(cfg.migrateStyles, true);
  assert.equal(cfg.pageLayout, "layouts/page.njk");
  assert.equal(cfg.postLayout, "layouts/post.njk");
  assert.equal(cfg.stylesDir, DEFAULT_KADENCE_STYLES_DIR);
  assert.equal(cfg.htmlMode, "keep-html");
});

test("createConfigFromInput applies kadence-pro preset defaults", async () => {
  const cfg = await createConfigFromInput({ preset: "kadence-pro" });
  assert.equal(cfg.preset, "kadence-pro");
  assert.equal(cfg.useNunjucksLayouts, true);
  assert.equal(cfg.convertKadenceBlocks, true);
  assert.equal(cfg.migrateStyles, true);
  assert.equal(cfg.stylesDir, DEFAULT_KADENCE_PRO_STYLES_DIR);
});

test("createConfigFromInput rejects unknown preset and falls back to none", async () => {
  const cfg = await createConfigFromInput({ preset: "elementor" });
  assert.equal(cfg.preset, "none");
});

test("createConfigFromInput parses csv contentTypes", async () => {
  const cfg = await createConfigFromInput({ contentTypes: "posts, pages, docs" });
  assert.deepEqual(cfg.contentTypes, ["posts", "pages", "docs"]);
});

test("createConfigFromInput normalises wpBaseUrl trailing slashes", async () => {
  const cfg = await createConfigFromInput({ wpBaseUrl: "https://example.com///" });
  assert.equal(cfg.wpBaseUrl, "https://example.com");
});

test("createConfigFromInput preserves secrets as-is (redaction is separate)", async () => {
  const cfg = await createConfigFromInput({
    authMode: "app-password",
    wpUser: "editor",
    wpAppPassword: "super-secret-abcd-1234"
  });
  assert.equal(cfg.authMode, "app-password");
  assert.equal(cfg.wpUser, "editor");
  assert.equal(cfg.wpAppPassword, "super-secret-abcd-1234");
});

test("createConfigFromInput coerces htmlMode to keep-html unless basic-markdown", async () => {
  const cfgA = await createConfigFromInput({ htmlMode: "junk-value" });
  assert.equal(cfgA.htmlMode, "keep-html");
  const cfgB = await createConfigFromInput({ htmlMode: "basic-markdown" });
  assert.equal(cfgB.htmlMode, "basic-markdown");
});

test("parseCsvList splits and trims", () => {
  assert.deepEqual(parseCsvList("a, b ,  c"), ["a", "b", "c"]);
  assert.deepEqual(parseCsvList(""), []);
  assert.deepEqual(parseCsvList(null), []);
});

test("nowStamp returns YYYYMMDD-HHMMSS format", () => {
  const stamp = nowStamp();
  assert.match(stamp, /^\d{8}-\d{6}$/);
});

test("resolveOutputRoot handles absolute, relative and fallback cases", () => {
  const stamp = "20260914-120000";
  assert.equal(
    resolveOutputRoot("", "", stamp),
    `./migrations/wp-to-eleventy-${stamp}`
  );
  assert.equal(resolveOutputRoot("/abs/path", "", stamp), "/abs/path");
  assert.equal(resolveOutputRoot("./rel/path", "", stamp), "./rel/path");
});

test("normalizeEleventyReplacements drops incomplete rows", () => {
  const input = [
    { slug: "a", wordpressPlugin: "p1", eleventySolution: "s1" },
    { slug: "b", wordpressPlugin: "", eleventySolution: "s2" },
    { slug: "", wordpressPlugin: "p3", eleventySolution: "s3" },
    { slug: "d", wordpressPlugin: "p4", eleventySolution: "s4", enabled: false }
  ];
  const out = normalizeEleventyReplacements(input);
  assert.equal(out.length, 2);
  assert.equal(out[0].slug, "a");
  assert.equal(out[0].enabled, true);
  assert.equal(out[1].slug, "d");
  assert.equal(out[1].enabled, false);
});

test("normalizeEleventyReplacements returns empty array for non-array input", () => {
  assert.deepEqual(normalizeEleventyReplacements(null), []);
  assert.deepEqual(normalizeEleventyReplacements(undefined), []);
  assert.deepEqual(normalizeEleventyReplacements("nope"), []);
});
