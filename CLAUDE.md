# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run migrate:wp                       # Interactive terminal wizard
npm run migrate:wp:run -- config.json    # Run from a saved JSON config file
npm run migrate:wp:gui                   # Start web UI server (port 4173)
```

No build step, test suite, or linter is configured. The project is a single ESM module with zero external dependencies.

## Architecture

This is a CLI/web tool that migrates WordPress sites to Eleventy via the WordPress REST API. All logic lives in `scripts/wp-eleventy-migrate.mjs` (~1,100 lines). The `ui/index.html` is a self-contained single-page web app served by the script's built-in HTTP server.

### Three entry points, one engine

- **Wizard** (`runWizard()`) — 13-step interactive terminal prompts via `readline`
- **Config file** (`runFromConfig(configPath)`) — reads a JSON config directly
- **Web UI** (`serveUi(port)`) — HTTP server that serves `ui/index.html` and accepts form submissions

All three normalize input through `createConfigFromInput(raw)` before calling `runMigration()`.

### Migration pipeline

`runMigration()` is the core engine:

1. Fetch WordPress REST API — taxonomies, posts/pages, menus, stylesheets
2. For each content item, `itemToDoc()` builds YAML front matter + body
3. Body is either kept as HTML or converted via `basicHtmlToMarkdown()` (regex-based)
4. If `convertKadenceBlocks` is enabled, `convertKadenceBlocksToNunjucks()` parses Gutenberg `<!-- wp:block -->` comment syntax into a tree and renders Nunjucks `{% include %}` calls
5. Optionally download media, migrate stylesheets, export menus as JSON, build redirect CSV
6. Write all files (skip when `dryRun: true`), then write `migration-report.json`

### Kadence block conversion

`parseWpBlocks(content)` tokenizes Gutenberg block comments into an AST. `renderBlockTree(nodes, config)` traverses it and emits Nunjucks includes pointing to partials under `_includes/blocks/kadence/`. `writeKadencePartials()` generates the 18 default partial templates.

### Preset system

Three presets (`none`, `kadence`, `kadence-pro`) auto-configure `stylesDir`, `kadenceBlocksDir`, `convertKadenceBlocks`, `migrateStyles`, and `useNunjucksLayouts`. Preset logic is applied inside `createConfigFromInput()`.

### Menu import

`fetchMenus()` tries three different WordPress menu API endpoints in sequence (WP REST menus v1, REST Menus v2, Menus API plugin) and falls back gracefully. `buildMenuTree()` normalizes the result into a hierarchical JSON structure written to `_data/navigation.json`.

### Output structure

```
<outputRoot>/
├── content/posts/*.md (or .njk for Kadence)
├── content/pages/*.md
├── media/                  # optional
├── _data/navigation.json   # optional
├── _includes/blocks/kadence/*.njk  # optional
├── styles/*/               # optional
├── redirects.csv           # optional
├── migration-config.json
└── migration-report.json
```

The `outputRoot` defaults to a timestamped directory under `./migrations/`.

### Config shape

Key fields: `wpBaseUrl`, `contentTypes`, `htmlMode` (`keep-html` | `basic-markdown`), `preset`, `convertKadenceBlocks`, `useNunjucksLayouts`, `migrateStyles`, `downloadMedia`, `authMode`, `dryRun`. See `configs/generation-ai-stn.fi.json` for a real-world example.
