// Generic WordPress shortcode parser.
//
// Tokenises `[name attr="value"]…[/name]` style syntax into a tree AST
// with source spans on every node. Source-agnostic: no WPBakery,
// Total, Kadence, or site-specific knowledge. Consumed by
// src/app/analyze.mjs and, in later PRs, by page-builder/plugin
// transformers.
//
// Locked contract (arch-v2-02 §1):
//   1. Structural support: paired, self-closing, nested trees.
//   2. Source preservation: every AST node exposes { start, end }.
//   3. No guess-repair: malformed / escaped syntax becomes an
//      "unhandled" source unit — never rewritten or dropped.
//   4. Original content is never flattened. Malformed regions remain
//      verbatim in `text` nodes so downstream reports can re-quote them.
//
// This module contains no rendering, no engine imports, and no I/O.

/** @typedef {"text" | "shortcode" | "unhandled"} NodeKind */

/**
 * Parse a raw content string into an array of top-level AST nodes.
 *
 * Return value shape:
 *   [
 *     { type: "text", value: "…", start, end },
 *     { type: "shortcode",
 *       name: "vc_row",
 *       attrs: { … },
 *       selfClosing: false,
 *       children: [ …recursive… ],
 *       start, end },
 *     { type: "unhandled",
 *       kind: "escaped-shortcode" | "malformed-shortcode",
 *       reason: "…",
 *       text: "…verbatim source…",
 *       start, end }
 *   ]
 *
 * @param {string} rawContent  Any string; empty input yields [].
 * @param {object} [options]
 * @param {Set<string>} [options.selfClosingNames]
 *        Names that are treated as self-closing even without a `/`
 *        suffix or `[/name]`. Kept optional so this parser has zero
 *        source-specific knowledge; callers register (e.g.)
 *        `vc_empty_space` themselves.
 * @returns {Array<object>}
 */
export function parseShortcodes(rawContent, options = {}) {
  const source = typeof rawContent === "string" ? rawContent : "";
  if (source.length === 0) return [];
  const selfClosingNames = options.selfClosingNames instanceof Set
    ? options.selfClosingNames
    : new Set();

  const tokens = tokenize(source);
  const root = { type: "root", children: [] };
  const stack = [root];

  for (const token of tokens) {
    const parent = stack[stack.length - 1];

    if (token.type === "text") {
      parent.children.push({
        type: "text",
        value: token.value,
        start: token.start,
        end: token.end
      });
      continue;
    }

    if (token.type === "unhandled") {
      parent.children.push({
        type: "unhandled",
        kind: token.kind,
        reason: token.reason,
        text: token.text,
        start: token.start,
        end: token.end
      });
      continue;
    }

    if (token.type === "shortcode-open") {
      const explicitSelfClose = token.selfClose === true;
      const registeredSelfClose = selfClosingNames.has(token.name);
      const selfClosing = explicitSelfClose || registeredSelfClose;

      const node = {
        type: "shortcode",
        name: token.name,
        attrs: token.attrs,
        selfClosing,
        children: [],
        start: token.start,
        end: token.end
      };
      parent.children.push(node);
      if (!selfClosing) stack.push(node);
      continue;
    }

    if (token.type === "shortcode-close") {
      // Find nearest matching open on the stack. If found, pop everything
      // above it back into the parent (they become malformed — never
      // dropped). If not found, this closing tag is itself malformed.
      let matchIndex = -1;
      for (let i = stack.length - 1; i >= 1; i -= 1) {
        if (stack[i].name === token.name) {
          matchIndex = i;
          break;
        }
      }
      if (matchIndex === -1) {
        // Orphan closer — no matching opener.
        parent.children.push({
          type: "unhandled",
          kind: "malformed-shortcode",
          reason: `Closing tag [/${token.name}] with no matching opener`,
          text: token.text,
          start: token.start,
          end: token.end
        });
        continue;
      }
      // Everything above matchIndex was opened but never closed.
      for (let i = stack.length - 1; i > matchIndex; i -= 1) {
        const orphan = stack[i];
        // Remove the orphan from its parent's children (it was pushed
        // when we opened it) and re-emit it as unhandled + return its
        // already-collected children back to grandparent verbatim.
        const grandparent = stack[i - 1];
        const idx = grandparent.children.lastIndexOf(orphan);
        if (idx !== -1) grandparent.children.splice(idx, 1);
        grandparent.children.push({
          type: "unhandled",
          kind: "malformed-shortcode",
          reason: `Opening tag [${orphan.name}] never closed`,
          text: source.slice(orphan.start, orphan.end),
          start: orphan.start,
          end: orphan.end
        });
        for (const child of orphan.children) grandparent.children.push(child);
      }
      // Close the matched node.
      const closed = stack[matchIndex];
      closed.end = token.end;
      stack.length = matchIndex;
      continue;
    }
  }

  // Anything left on the stack (except the root) was never closed.
  // Re-emit each unclosed opener as unhandled + spill its children up.
  while (stack.length > 1) {
    const orphan = stack.pop();
    const parent = stack[stack.length - 1];
    const idx = parent.children.lastIndexOf(orphan);
    if (idx !== -1) parent.children.splice(idx, 1);
    parent.children.push({
      type: "unhandled",
      kind: "malformed-shortcode",
      reason: `Opening tag [${orphan.name}] never closed`,
      text: source.slice(orphan.start, orphan.end),
      start: orphan.start,
      end: orphan.end
    });
    for (const child of orphan.children) parent.children.push(child);
  }

  return root.children;
}

/**
 * Walk an AST and count how many times each shortcode name appears,
 * summed across the whole tree.
 *
 * @param {Array<object>} nodes
 * @returns {Record<string, number>}
 */
export function countShortcodes(nodes) {
  const counts = {};
  const walk = (list) => {
    for (const node of list || []) {
      if (node.type === "shortcode") {
        counts[node.name] = (counts[node.name] || 0) + 1;
        if (node.children) walk(node.children);
      }
    }
  };
  walk(nodes);
  return counts;
}

/**
 * Flatten an AST into a list of unhandled entries (escaped / malformed).
 * Each entry preserves its source span so callers can re-quote the
 * original text verbatim.
 *
 * @param {Array<object>} nodes
 * @returns {Array<{ kind: string, reason: string, text: string, start: number, end: number }>}
 */
export function collectUnhandled(nodes) {
  const out = [];
  const walk = (list) => {
    for (const node of list || []) {
      if (node.type === "unhandled") {
        out.push({
          kind: node.kind,
          reason: node.reason,
          text: node.text,
          start: node.start,
          end: node.end
        });
      } else if (node.type === "shortcode" && node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

// ---- tokeniser ------------------------------------------------------------

/** Whether `ch` is a valid opening character for a shortcode name. */
function isNameStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}
function isNameChar(ch) {
  return isNameStart(ch) || (ch >= "0" && ch <= "9") || ch === "-";
}

/**
 * Produce a flat stream of tokens: text | shortcode-open |
 * shortcode-close | unhandled (escaped/malformed).
 */
function tokenize(source) {
  const tokens = [];
  let i = 0;
  let textStart = 0;

  const flushText = (until) => {
    if (until > textStart) {
      tokens.push({
        type: "text",
        value: source.slice(textStart, until),
        start: textStart,
        end: until
      });
    }
    textStart = until;
  };

  while (i < source.length) {
    const ch = source[i];

    // Backslash-escaped bracket: `\[…\]` — WordPress renders it as
    // literal text. We report the escaped region as unhandled so the
    // report can flag any active-looking content that the user
    // intended to be verbatim.
    if (ch === "\\" && source[i + 1] === "[") {
      const escapeEnd = findEscapedShortcodeEnd(source, i);
      if (escapeEnd > i) {
        flushText(i);
        tokens.push({
          type: "unhandled",
          kind: "escaped-shortcode",
          reason: "Backslash-escaped shortcode; WordPress renders it as literal text",
          text: source.slice(i, escapeEnd),
          start: i,
          end: escapeEnd
        });
        i = escapeEnd;
        textStart = i;
        continue;
      }
    }

    if (ch === "[") {
      // Double-bracket escape: `[[name …]]` — WordPress prints the
      // literal `[name …]`. Report as unhandled/escaped.
      if (source[i + 1] === "[") {
        const doubleEnd = findDoubleBracketEnd(source, i);
        if (doubleEnd > i) {
          flushText(i);
          tokens.push({
            type: "unhandled",
            kind: "escaped-shortcode",
            reason: "Double-bracket escape; WordPress renders the inner text literally",
            text: source.slice(i, doubleEnd),
            start: i,
            end: doubleEnd
          });
          i = doubleEnd;
          textStart = i;
          continue;
        }
      }

      // Closing tag: `[/name]`
      if (source[i + 1] === "/") {
        const parsed = parseClosingTag(source, i);
        if (parsed) {
          flushText(i);
          tokens.push(parsed);
          i = parsed.end;
          textStart = i;
          continue;
        }
        // Malformed closer — record and skip past the `[` alone so
        // subsequent characters are still tokenised. The `[/` region up
        // to the next line-end becomes an unhandled unit.
        const malformedEnd = findMalformedEnd(source, i);
        flushText(i);
        tokens.push({
          type: "unhandled",
          kind: "malformed-shortcode",
          reason: "Malformed closing shortcode tag",
          text: source.slice(i, malformedEnd),
          start: i,
          end: malformedEnd
        });
        i = malformedEnd;
        textStart = i;
        continue;
      }

      // Opening tag: `[name …]` or `[name … /]`
      const parsed = parseOpeningTag(source, i);
      if (parsed) {
        flushText(i);
        tokens.push(parsed);
        i = parsed.end;
        textStart = i;
        continue;
      }
      // Not a valid opener — could be prose (`[note]` in text) or
      // malformed (`[name attr="v"` with no closing bracket). We only
      // flag as malformed if the region looks shortcode-like but is
      // not well formed; otherwise it's plain text.
      if (looksLikeUnclosedShortcode(source, i)) {
        const malformedEnd = findMalformedEnd(source, i);
        flushText(i);
        tokens.push({
          type: "unhandled",
          kind: "malformed-shortcode",
          reason: "Unclosed shortcode opening bracket",
          text: source.slice(i, malformedEnd),
          start: i,
          end: malformedEnd
        });
        i = malformedEnd;
        textStart = i;
        continue;
      }
      // Plain bracket in prose — advance one character; still part of
      // the enclosing text token.
      i += 1;
      continue;
    }
    i += 1;
  }
  flushText(source.length);
  return tokens;
}

function findEscapedShortcodeEnd(source, start) {
  // Skip past `\[`, then find `\]` closing. If not found on the same
  // logical line, we still consume through the `\]` if it exists
  // anywhere further on; otherwise fall back to end of line.
  let i = start + 2;
  while (i < source.length) {
    if (source[i] === "\\" && source[i + 1] === "]") return i + 2;
    if (source[i] === "\n") return i;
    i += 1;
  }
  return source.length;
}

function findDoubleBracketEnd(source, start) {
  // Match `[[…]]` where the inner text has no newlines. Return the
  // index just past the closing `]]`.
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\n") return start + 1; // not a valid escape, back off
    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return start + 1;
}

function parseOpeningTag(source, start) {
  // Precondition: source[start] === "["
  let i = start + 1;
  if (!isNameStart(source[i])) return null;
  const nameStart = i;
  while (i < source.length && isNameChar(source[i])) i += 1;
  const name = source.slice(nameStart, i);
  // Attributes segment runs until `]` on the same line, or the tag is malformed.
  const attrStart = i;
  let bracketEnd = -1;
  let selfClose = false;
  for (let j = i; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === "\n") break;
    if (ch === "]") {
      // Detect trailing "/" before "]".
      const beforeBracket = source.slice(attrStart, j).trimEnd();
      if (beforeBracket.endsWith("/")) selfClose = true;
      bracketEnd = j + 1;
      break;
    }
  }
  if (bracketEnd === -1) return null; // no `]` before end of line → malformed
  const rawAttrs = source.slice(attrStart, bracketEnd - 1);
  const attrsClean = selfClose ? rawAttrs.trimEnd().slice(0, -1) : rawAttrs;
  return {
    type: "shortcode-open",
    name,
    attrs: parseAttrs(attrsClean),
    selfClose,
    start,
    end: bracketEnd
  };
}

function parseClosingTag(source, start) {
  // Precondition: source[start] === "[" && source[start + 1] === "/"
  let i = start + 2;
  if (!isNameStart(source[i])) return null;
  const nameStart = i;
  while (i < source.length && isNameChar(source[i])) i += 1;
  const name = source.slice(nameStart, i);
  // Skip any whitespace before `]`.
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i += 1;
  if (source[i] !== "]") return null;
  return {
    type: "shortcode-close",
    name,
    text: source.slice(start, i + 1),
    start,
    end: i + 1
  };
}

function looksLikeUnclosedShortcode(source, start) {
  // Heuristic: `[` followed immediately by a name character, no `]` on
  // the same line. This distinguishes prose like `[edit]` (well-formed
  // and harmless — will still be captured as a shortcode by
  // parseOpeningTag) from something like `[vc_row attr="v"` that has
  // no closing bracket at all.
  if (!isNameStart(source[start + 1])) return false;
  for (let j = start + 1; j < source.length; j += 1) {
    if (source[j] === "\n") return true; // ran off the line with no `]`
    if (source[j] === "]") return false;  // has a closing bracket → parseOpeningTag handles it
  }
  return true; // ran off the source
}

function findMalformedEnd(source, start) {
  // Consume up to and including the next newline, or end of source.
  for (let j = start; j < source.length; j += 1) {
    if (source[j] === "\n") return j + 1;
  }
  return source.length;
}

function parseAttrs(rawAttrs) {
  const attrs = {};
  const s = String(rawAttrs || "").trim();
  if (!s) return attrs;
  // WordPress attribute syntax: name="value" | name='value' | name=value | bareword
  const re = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))|([a-zA-Z_][\w-]*)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) {
      attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
    } else if (m[5]) {
      attrs[m[5]] = true;
    }
  }
  return attrs;
}
