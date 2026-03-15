#!/usr/bin/env node
/**
 * fix-yaml-quotes.mjs
 * Fixes unescaped double-quotes inside YAML double-quoted scalar fields
 * (title, excerpt) in translated Eleventy content files.
 *
 * Also repairs broken block-scalar lines left by a previous run of this script
 * (e.g. title: ">-" followed by indented continuation lines).
 */
import fs from "node:fs";
import path from "node:path";

// Re-serialize a single-line title/excerpt YAML value safely.
// Returns the original line unchanged if it looks like a block scalar or is fine.
function fixScalarLine(line) {
  const m = line.match(/^(title|excerpt): (.+)$/);
  if (!m) return line;
  const val = m[2].trim();

  // Leave block scalar indicators untouched (>, >-, |, |-)
  if (/^[>|]/.test(val)) return line;

  // Strip outer quotes, unescape internals
  let inner;
  if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
    inner = val.slice(1, -1).replace(/\\"/g, '"');
  } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
    inner = val.slice(1, -1).replace(/''/g, "'");
  } else {
    // Unquoted — only touch if it contains double-quotes
    if (!val.includes('"')) return line;
    inner = val;
  }

  // Re-serialize with JSON.stringify so internal " become \"
  return `${m[1]}: ${JSON.stringify(inner)}`;
}

// Detect and repair block-scalars that were broken by a previous bad run:
// title: ">-"          ← broken: should be  title: >-
//   actual content     ←                       actual content
function repairBrokenBlockScalar(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Pattern: title: ">-" or excerpt: "|-" etc., AND next line is indented
    const brokenM = line.match(/^(title|excerpt): "(>-?|\|-?)"$/);
    if (brokenM && i + 1 < lines.length && lines[i + 1].startsWith("  ")) {
      // Restore the block scalar indicator line
      out.push(`${brokenM[1]}: ${brokenM[2]}`);
    } else {
      out.push(line);
    }
  }
  return out;
}

function fixFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const sep = content.indexOf("\n---\n", 4);
  if (!content.startsWith("---\n") || sep === -1) return false;

  const yamlBlock = content.slice(4, sep);
  const rest = content.slice(sep);

  const lines = yamlBlock.split("\n");
  const repairedLines = repairBrokenBlockScalar(lines);
  const fixedLines = repairedLines.map(fixScalarLine);
  const fixedYaml = fixedLines.join("\n");

  const fixed = `---\n${fixedYaml}${rest}`;
  if (fixed !== content) {
    fs.writeFileSync(filePath, fixed, "utf8");
    return true;
  }
  return false;
}

const base = process.argv[2] || "/Users/jlaru/Documents/www/GenAI7/content";
let fixed = 0, checked = 0;
for (const lang of ["sv", "en"]) {
  for (const type of ["posts", "pages"]) {
    const dir = path.join(base, lang, type);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md") && !f.endsWith(".njk")) continue;
      checked++;
      if (fixFile(path.join(dir, f))) {
        fixed++;
        console.log(`Fixed: ${lang}/${type}/${f}`);
      }
    }
  }
}
console.log(`\nChecked: ${checked}  Fixed: ${fixed}`);
