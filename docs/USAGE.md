# Usage Guide

Wizard asks:

1. Source type (`rest`, `xml`, `json`)
2. WordPress base URL and API namespace
3. Content types to migrate (`posts,pages` etc.)
4. Draft/private inclusion
5. HTML mode (`keep-html` or `basic-markdown`)
6. Redirect map generation
7. Media download
8. Auth mode (`none`, `app-password`, `bearer`)
9. Output paths
10. Dry-run mode

Recommended workflow:

1. Run dry-run first
2. Inspect `migration-report.json`
3. Validate `redirects.csv`
4. Re-run with `dryRun=false`
5. Build your Eleventy project and run link checks
