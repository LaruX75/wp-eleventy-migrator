import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseShortcodes,
  countShortcodes,
  collectUnhandled
} from "../src/blocks/shortcode-parser.mjs";

// Unit tests for the standalone shortcode parser. These do not use
// analyze, mock servers, or fixtures — the parser is pure and its
// contract is locked in arch-v2-02 §1.

test("nested paired shortcodes form a tree, not a flat list", () => {
  const src = `[outer][inner]body[/inner][/outer]`;
  const nodes = parseShortcodes(src);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "shortcode");
  assert.equal(nodes[0].name, "outer");
  assert.equal(nodes[0].selfClosing, false);
  // Outer must contain the inner shortcode as its child, not siblings.
  const innerNodes = nodes[0].children.filter((n) => n.type === "shortcode");
  assert.equal(innerNodes.length, 1);
  assert.equal(innerNodes[0].name, "inner");
  assert.deepEqual(countShortcodes(nodes), { outer: 1, inner: 1 });
});

test("self-closing shortcode: explicit `/` marker", () => {
  const src = `[rev_slider alias="promo" /]`;
  const nodes = parseShortcodes(src);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "shortcode");
  assert.equal(nodes[0].name, "rev_slider");
  assert.equal(nodes[0].selfClosing, true);
  assert.equal(nodes[0].attrs.alias, "promo");
  assert.equal(nodes[0].children.length, 0);
});

test("self-closing shortcode: registered via options", () => {
  const src = `[vc_empty_space height="16px"]`;
  const nodes = parseShortcodes(src, {
    selfClosingNames: new Set(["vc_empty_space"])
  });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, "vc_empty_space");
  assert.equal(nodes[0].selfClosing, true);
  assert.equal(nodes[0].attrs.height, "16px");
});

test("escaped shortcode via backslash is unhandled, not active", () => {
  const src = `Docs: \\[vc_row\\] means literal text.`;
  const nodes = parseShortcodes(src);
  const unhandled = collectUnhandled(nodes);
  assert.equal(unhandled.length, 1);
  assert.equal(unhandled[0].kind, "escaped-shortcode");
  assert.match(unhandled[0].reason, /Backslash-escaped/i);
  // The original text is preserved verbatim.
  assert.equal(unhandled[0].text, "\\[vc_row\\]");
  // No active shortcode should have been recognised.
  assert.deepEqual(countShortcodes(nodes), {});
});

test("escaped shortcode via double bracket is unhandled, not active", () => {
  const src = `Sometimes [[vc_row]] renders literally.`;
  const nodes = parseShortcodes(src);
  const unhandled = collectUnhandled(nodes);
  assert.equal(unhandled.length, 1);
  assert.equal(unhandled[0].kind, "escaped-shortcode");
  assert.match(unhandled[0].reason, /Double-bracket/i);
  assert.equal(unhandled[0].text, "[[vc_row]]");
  assert.deepEqual(countShortcodes(nodes), {});
});

test("malformed shortcode: missing closing bracket → unhandled, not flattened", () => {
  const src = `intro
[vc_row attr="v"
after`;
  const nodes = parseShortcodes(src);
  const unhandled = collectUnhandled(nodes);
  assert.equal(unhandled.length, 1);
  assert.equal(unhandled[0].kind, "malformed-shortcode");
  assert.match(unhandled[0].reason, /Unclosed shortcode opening bracket/i);
  // Verbatim source preserved in the AST.
  assert.match(unhandled[0].text, /vc_row attr="v"/);
  // The "intro" and "after" text is still present as text nodes.
  const textValues = nodes.filter((n) => n.type === "text").map((n) => n.value);
  assert.ok(textValues.some((t) => t.includes("intro")));
  assert.ok(textValues.some((t) => t.includes("after")));
});

test("malformed shortcode: unclosed opener → tree ships with unhandled node, source preserved", () => {
  const src = `[vc_column]content that never closes`;
  const nodes = parseShortcodes(src);
  const unhandled = collectUnhandled(nodes);
  assert.equal(unhandled.length, 1);
  assert.equal(unhandled[0].kind, "malformed-shortcode");
  assert.match(unhandled[0].reason, /never closed/i);
  // Original text remains available for the report.
  assert.match(unhandled[0].text, /\[vc_column\]/);
});

test("orphan closing tag `[/name]` with no opener is unhandled", () => {
  const src = `body [/nowhere] more body`;
  const nodes = parseShortcodes(src);
  const unhandled = collectUnhandled(nodes);
  assert.equal(unhandled.length, 1);
  assert.equal(unhandled[0].kind, "malformed-shortcode");
  assert.match(unhandled[0].reason, /Closing tag/i);
});

test("source spans identify original bytes for every recognised unit", () => {
  const src = `pre [vc_row][vc_column]body[/vc_column][/vc_row] post`;
  const nodes = parseShortcodes(src);
  const row = nodes.find((n) => n.type === "shortcode" && n.name === "vc_row");
  assert.ok(row, "expected vc_row at top level");
  // start..end spans the whole `[vc_row]…[/vc_row]` region.
  assert.equal(src.slice(row.start, row.end).startsWith("[vc_row]"), true);
  assert.equal(src.slice(row.start, row.end).endsWith("[/vc_row]"), true);
  const col = row.children.find((n) => n.type === "shortcode" && n.name === "vc_column");
  assert.ok(col, "expected vc_column inside vc_row");
  assert.equal(src.slice(col.start, col.end).startsWith("[vc_column]"), true);
  assert.equal(src.slice(col.start, col.end).endsWith("[/vc_column]"), true);
});

test("attrs parse quoted, unquoted, and bareword forms", () => {
  const nodes = parseShortcodes(`[demo a="one" b='two' c=three flag]body[/demo]`);
  const demo = nodes[0];
  assert.equal(demo.attrs.a, "one");
  assert.equal(demo.attrs.b, "two");
  assert.equal(demo.attrs.c, "three");
  assert.equal(demo.attrs.flag, true);
});

test("empty input returns empty node list", () => {
  assert.deepEqual(parseShortcodes(""), []);
  assert.deepEqual(parseShortcodes(null), []);
  assert.deepEqual(parseShortcodes(undefined), []);
});

test("bracket-like text without a valid name stays as text; unclosed opener is malformed, not dropped", () => {
  // `[42]` starts with a digit — not a valid shortcode name. It must
  // remain in a text node. `[note attr]` opens a shortcode but is
  // never closed → the tree closes it as an unhandled malformed unit
  // (source preserved), while its opener + surrounding prose stays
  // available as text and unhandled nodes. What must NOT happen:
  // dropping either region or coercing `[42]` into a shortcode.
  const nodes = parseShortcodes(`prose [42] and [note attr] tail`);
  // `[note attr]` opens but never closes → surfaces as unhandled.
  const unhandled = collectUnhandled(nodes);
  assert.equal(unhandled.length, 1);
  assert.equal(unhandled[0].kind, "malformed-shortcode");
  assert.match(unhandled[0].text, /\[note attr\]/);
  // `[42]` remains inside a text node.
  const textValues = nodes
    .filter((n) => n.type === "text")
    .map((n) => n.value)
    .join("");
  assert.match(textValues, /\[42\]/);
  assert.match(textValues, /prose/);
  assert.match(textValues, /tail/);
});
