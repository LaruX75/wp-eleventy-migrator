# CLAUDE.md

This file guides Claude Code and other coding agents working in this repository.

## Product contract

`wp-eleventy-migrator` is a **generic, one-shot WordPress → Eleventy migrator**. It is for cases where the WordPress installation is retired after acceptance of the generated site. Its primary target is native Eleventy content: Markdown documents with YAML front matter, preserved HTML where appropriate, and Nunjucks only where an explicitly selected transformer emits it.

It is not a WordPress theme converter, an always-on synchronizer, or a site-specific jarilaru.fi tool.

Baseline: `d68ddf789cb9f61a484596e9c6cd0887de620725`. The current engine is `scripts/wp-eleventy-migrate.mjs` (239,595 bytes; roughly 5,287 lines). The UI is `ui/index.html` (231,412 bytes). Treat both as legacy monoliths to be decomposed; do not add new cross-cutting features to them.

Architecture decisions and the modularisation roadmap are in `docs/architecture-v2-01-2026-09-14.md`. The source and gap audits belong in `docs/`; they are required reading before implementing a P0/P1 item.

## Commands

```bash
npm run migrate:wp                       # interactive terminal wizard
npm run migrate:wp:run -- config.json    # run a saved JSON config
npm run migrate:wp:gui                   # serve the web UI (default port 4173)
npm run audit:visual -- <args>            # visual audit utility
npm run audit:site -- <args>              # site-level visual audit
npm run translate:missing -- <args>       # legacy translation utility
```

There is currently no test suite, build step, or linter. Any implementation work must add focused automated tests before changing a P0 path.

## Non-negotiable migration rules

- Use REST API with a WordPress Application Password as the normal authenticated source. Public REST is only a capability sniff-test, never the assumed data source.
- Require an XML export backup before the write phase. Do not store credentials in generated config, reports, or logs.
- The default content output is `content/<type>/<slug>.md`: YAML front matter plus body. `_data/*.json` is reserved for truly site-wide data such as navigation.
- Preserve source HTML block-by-block in the generic core. Never perform lossy regex “normalisation” by default.
- Nunjucks shortcodes, macros, includes, and theme/block conversions are opt-in transformers. They must declare their input signature, output contract, diagnostic behaviour, and tests.
- Retain a source identity and original URL for every migrated item so redirects, deduplication, and post-migration verification remain possible.
- A migration writes to a fresh output directory; it must not silently merge into an existing generated site.
- `migrations/` contains historical runs. Do not edit or use it as an implementation fixture. Keep it out of commits unless a deliberate fixture policy is introduced.

## Current legacy behavior

All entry points normalize input through `createConfigFromInput(raw)` and invoke `runMigration()`.

The legacy pipeline currently fetches REST taxonomies, posts/pages, menus, and stylesheets; turns each item into a document; optionally applies regex-based Markdown conversion or Kadence conversion; optionally downloads media, stylesheets, menus, and redirects; then writes a report. Its Kadence parser reads Gutenberg comment syntax and writes generated partials. Presets currently include `none`, `kadence`, and `kadence-pro`.

This behavior is useful baseline evidence, not the v2 design. In particular, Kadence support (currently 32 recognised blocks) is a plugin transformer, not the generic output model.

## Implementation conventions

- Node ESM; keep external dependencies minimal and justified.
- Keep fetching, normalization, rendering, filesystem writing, diagnostics, CLI, and UI separate.
- Make the core deterministic: the same saved source snapshot plus config must produce the same files and manifest.
- Write a machine-readable manifest/report with source IDs, output paths, warnings, skipped items, asset results, redirects, and transformer versions.
- Prefer explicit warnings and safe preserved output over guessed semantic conversion.
- Config must be schema-validated, versioned, and capable of selecting only supported source/content/transformer features.
- UI and CLI must call the same public application service; neither may contain migration business logic.

## Change discipline

Before coding, identify the audit item, its acceptance criteria, source fixture, and output invariant. Preserve unrelated working-tree changes. Do not change historical migrations. Update the architecture document if a proposed change modifies one of its locked decisions.
