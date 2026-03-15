#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] || "/Users/jlaru/Documents/www/GenAI7/content";
let errors = 0, checked = 0;

for (const lang of ["sv", "en"]) {
  for (const type of ["posts", "pages"]) {
    const dir = path.join(base, lang, type);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md") && !f.endsWith(".njk")) continue;
      checked++;
      const content = fs.readFileSync(path.join(dir, f), "utf8");
      const sep = content.indexOf("\n---\n", 4);
      if (sep === -1) continue;
      const yaml = content.slice(4, sep);
      for (const line of yaml.split("\n")) {
        const m = line.match(/^(title|excerpt): "(.+)"$/);
        if (!m) continue;
        // Unescaped " inside: replace \" with placeholder, then check for remaining "
        const inner = m[2].replace(/\\"/g, "\x00");
        if (inner.includes('"')) {
          console.log(`BROKEN ${lang}/${type}/${f}: ${line.slice(0, 90)}`);
          errors++;
        }
      }
    }
  }
}
console.log(`\nChecked: ${checked}  Broken: ${errors}`);
