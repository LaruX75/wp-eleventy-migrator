# WordPress -> Eleventy Migrator

Generic, project-independent CLI for migrating content from WordPress to Eleventy.

## Features

- Interactive wizard UI (terminal prompts)
- Config-file based runs
- WordPress REST API source support
- Output as Markdown files with Eleventy-compatible front matter
- Optional redirect CSV generation
- Optional media download
- Dry-run mode and migration report

## Usage

```bash
npm run migrate:wp
```

Run from an existing config:

```bash
npm run migrate:wp:run -- ./path/to/migration-config.json
```

## Output

The tool writes (under outputRoot):

- `content/<type>/*.md`
- `redirects.csv` (optional)
- `migration-report.json`

