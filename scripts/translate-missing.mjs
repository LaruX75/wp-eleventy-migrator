#!/usr/bin/env node
/**
 * translate-missing.mjs
 * Finds Finnish (default-locale) posts/pages that have no sv/en counterpart
 * and translates them using Claude API.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/translate-missing.mjs \
 *     --site /path/to/GenAI7 [--langs sv,en] [--dry-run]
 */

import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = flag => args.includes(flag);

const siteRoot = get("--site") || process.cwd();
const targetLangs = (get("--langs") || "sv,en").split(",").map(s => s.trim()).filter(Boolean);
const dryRun = has("--dry-run");
const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error("ERROR: ANTHROPIC_API_KEY ei ole asetettu.\nAseta: export ANTHROPIC_API_KEY=sk-ant-...");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

// ── Language config ───────────────────────────────────────────────────────────
const LANG_META = {
  sv: {
    name: "Swedish",
    nativeName: "svenska",
    categoryMap: { ajankohtaista: "nyheter-fran", henkilot: "personal" },
    defaultCategory: "nyheter-fran",
    defaultPageCategory: "sv",
  },
  en: {
    name: "English",
    nativeName: "English",
    categoryMap: { ajankohtaista: "current-affairs", henkilot: "people" },
    defaultCategory: "current-affairs",
    defaultPageCategory: "en",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const datePrefix = filename => filename.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
const slugify = title =>
  title
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[åä]/g, "a").replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

async function listFiles(dir) {
  try { return (await fs.readdir(dir)).filter(f => f !== "posts.json" && f !== "pages.json"); }
  catch { return []; }
}

function parseFrontMatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw, raw };
  const yaml = match[1];
  const body = match[2];
  const fm = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { fm, body, rawYaml: yaml, raw };
}

// ── Translation via Claude ────────────────────────────────────────────────────
async function translateFile(content, targetLang, sourceFile) {
  const meta = LANG_META[targetLang];
  const ext = path.extname(sourceFile);
  const isNjk = ext === ".njk";

  const systemPrompt = `You are a professional Finnish-to-${meta.name} translator specializing in educational technology and AI content.

RULES — follow these exactly:
1. Translate ALL human-readable Finnish text to ${meta.name} (${meta.nativeName}).
2. In .njk Nunjucks/Eleventy files: translate ONLY the text content inside {% set kadenceInnerHtml %} blocks and frontmatter title/excerpt. Preserve every {% %}, {{ }}, {# #} tag, JSON block attributes, HTML tags and their attributes, URLs, and all structural syntax unchanged.
3. In .md files: translate the YAML frontmatter fields "title" and "excerpt", and translate the HTML/markdown body text. Preserve all HTML tags, attributes, URLs, and code blocks.
4. Frontmatter fields to translate: title, excerpt. Leave all other frontmatter fields (date, slug, permalink, status, sourceType, sourceId, sourceUrl, categories, tags, lang, author, layout, kadenceBlocks, etc.) UNCHANGED — they will be updated programmatically.
5. Translate category names in the "categories" array to ${meta.name} equivalents.
6. YAML QUOTING: In YAML frontmatter, if a string value contains double-quote characters ("), you MUST escape them as \\" (backslash-quote) inside a double-quoted YAML value, OR wrap the value in single quotes and escape any single quote as ''. Never leave unescaped double quotes inside a double-quoted YAML string.
7. Return ONLY the complete translated file content, no explanation, no markdown fences.`;

  const userPrompt = `Translate this Finnish Eleventy content file to ${meta.name}.\nFile: ${sourceFile}\n\n${content}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  return message.content[0].text;
}

// ── YAML safety: re-serialize title/excerpt lines to fix unescaped quotes ────
function fixYamlScalarLine(line) {
  const m = line.match(/^(title|excerpt): (.*)$/s);
  if (!m) return line;
  let val = m[2].trim();
  // Strip outer double-quote wrapper (first and last char)
  if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
    val = val.slice(1, -1).replace(/\\"/g, '"');
  } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
    val = val.slice(1, -1).replace(/''/g, "'");
  }
  // Re-serialize: JSON.stringify produces valid YAML double-quoted string
  return `${m[1]}: ${JSON.stringify(val)}`;
}

function fixYamlQuotes(content) {
  const sep = content.indexOf("\n---\n", 4);
  if (!content.startsWith("---\n") || sep === -1) return content;
  const yamlBlock = content.slice(4, sep);
  const rest = content.slice(sep);
  const fixedYaml = yamlBlock
    .split("\n")
    .map(line => fixYamlScalarLine(line))
    .join("\n");
  return `---\n${fixedYaml}${rest}`;
}

// ── Post-process translated content ──────────────────────────────────────────
function patchFrontMatter(translatedContent, fiFile, targetLang, contentType) {
  const meta = LANG_META[targetLang];
  const { fm, body, rawYaml } = parseFrontMatter(translatedContent);

  // Derive slug from translated title
  const translatedTitle = fm.title || "";
  const newSlug = slugify(translatedTitle) || slugify(path.basename(fiFile, path.extname(fiFile)).slice(11));

  // Build permalink
  const isPost = contentType === "posts";
  const category = isPost ? meta.defaultCategory : targetLang;
  const newPermalink = `/${targetLang}/${category}/${newSlug}/`;

  // Build patched YAML — replace slug and permalink, add lang
  const patched = rawYaml
    .replace(/^slug:.*$/m, `slug: ${newSlug}`)
    .replace(/^permalink:.*$/m, `permalink: ${newPermalink}`)
    .replace(/^lang:.*$/m, `lang: ${targetLang}`)
    + (rawYaml.includes("lang:") ? "" : `\nlang: ${targetLang}`);

  return `---\n${patched}\n---\n${body}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const contentRoot = path.join(siteRoot, "content");

  console.log(`Site: ${siteRoot}`);
  console.log(`Target languages: ${targetLangs.join(", ")}`);
  console.log(`Dry run: ${dryRun}\n`);

  for (const lang of targetLangs) {
    if (!LANG_META[lang]) { console.warn(`Unknown lang: ${lang}, skipping`); continue; }

    for (const contentType of ["posts", "pages"]) {
      const fiDir = path.join(contentRoot, contentType);
      const targetDir = path.join(contentRoot, lang, contentType);

      const fiFiles = await listFiles(fiDir);
      const targetFiles = await listFiles(targetDir);
      const targetDates = new Set(targetFiles.map(datePrefix).filter(Boolean));

      const missing = fiFiles.filter(f => {
        const d = datePrefix(f);
        return d ? !targetDates.has(d) : !targetFiles.some(tf => tf === f);
      });

      if (missing.length === 0) {
        console.log(`[${lang}/${contentType}] Kaikki käännetty ✓`);
        continue;
      }

      console.log(`[${lang}/${contentType}] ${missing.length} käännöstä puuttuu`);
      await fs.mkdir(targetDir, { recursive: true });

      for (let i = 0; i < missing.length; i++) {
        const fiFile = missing[i];
        const fiPath = path.join(fiDir, fiFile);
        console.log(`  [${i + 1}/${missing.length}] ${fiFile}`);

        try {
          const content = await fs.readFile(fiPath, "utf8");

          let translated;
          if (dryRun) {
            translated = content; // skip API call in dry run
          } else {
            translated = await translateFile(content, lang, fiFile);
            translated = fixYamlQuotes(translated);
            translated = patchFrontMatter(translated, fiFile, lang, contentType);
          }

          // Derive output filename from translated title slug
          const { fm } = parseFrontMatter(translated);
          const newSlug = slugify(fm.title || "") || slugify(path.basename(fiFile, path.extname(fiFile)).slice(11));
          const prefix = datePrefix(fiFile) ? `${datePrefix(fiFile)}-` : "";
          const ext = path.extname(fiFile);
          const outFile = `${prefix}${newSlug}${ext}`;
          const outPath = path.join(targetDir, outFile);

          if (dryRun) {
            console.log(`    → (dry-run) would write: ${outFile}`);
          } else {
            await fs.writeFile(outPath, translated, "utf8");
            console.log(`    → ${outFile}`);
          }
        } catch (err) {
          console.error(`    ERROR: ${err.message}`);
        }
      }
    }
  }

  console.log("\nValmis.");
}

main().catch(err => { console.error(err); process.exit(1); });
