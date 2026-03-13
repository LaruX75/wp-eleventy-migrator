# WordPress -> Eleventy Migrator

Generic, project-independent CLI for migrating content from WordPress to Eleventy.

## Features

- Interactive wizard UI (terminal prompts)
- Config-file based runs
- WordPress REST API source support
- Output as Markdown files with Eleventy-compatible front matter
- Best-effort navigation/menu export to Eleventy data JSON
- Optional redirect CSV generation
- Optional media download
- Dry-run mode and migration report

## Usage

```bash
npm run migrate:wp
```

Run the HTML5 GUI:

```bash
npm run migrate:wp:gui
```

Run from an existing config:

```bash
npm run migrate:wp:run -- ./path/to/migration-config.json
```

Example config for `generation-ai-stn.fi`:

```bash
npm run migrate:wp:run -- ./configs/generation-ai-stn.fi.json
```

## Output

The tool writes (under outputRoot):

- `content/<type>/*.md`
- `_data/navigation.json` (best effort, if WordPress menu endpoints are available)
- `redirects.csv` (optional)
- `migration-report.json`
