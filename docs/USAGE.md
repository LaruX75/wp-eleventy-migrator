# Usage Guide

Wizard asks:

1. Source type (`rest`, `xml`, `json`)
2. WordPress base URL and API namespace
3. Content types to migrate (`posts,pages` etc.)
4. Draft/private inclusion
5. HTML mode (`keep-html` or `basic-markdown`)
6. Redirect map generation
7. Best-effort menu import
8. Media download
9. Auth mode (`none`, `app-password`, `bearer`)
10. Output paths
11. Dry-run mode

Recommended workflow:

1. Run dry-run first
2. Inspect `migration-report.json`
3. Validate `redirects.csv`
4. Re-run with `dryRun=false`
5. Inspect `_data/navigation.json` if menu import succeeded
6. Build your Eleventy project and run link checks

HTML5 GUI:

1. Start with `npm run migrate:wp:gui`
2. Open the local browser URL printed by the command
3. Fill the same migration fields as the CLI wizard
4. Save config or run migration directly from the page
