# REST snapshots (schema 1)

REST with a WordPress Application Password is the default capture source. A
snapshot is a portable, local input to the existing analyze and migration
pipeline. It is a read-only operation against WordPress: only GET requests.
This implements the source preservation/media coverage portion of audit P1-4
and the authenticated REST + WXR contract in architecture v2-01 §2.3.

## Capture

Create a JSON config (paths below are examples, not repository-local configs):

```json
{
  "sourceType": "rest",
  "wpBaseUrl": "https://wordpress.example",
  "authMode": "app-password",
  "xmlBackupPath": "./backup.xml",
  "snapshotOutputDir": "./source-snapshot"
}
```

Provide `WP_USER` and `WP_APP_PASSWORD` through the process environment using
your existing secret manager/session. Do not put their values in config,
command-line arguments, or shell history. Capture reuses the existing
Application Password Basic-auth header builder. There is no new keychain
integration. The snapshot command rejects credential fields in config.

```sh
node src/main.mjs snapshot /path/to/capture.json
# equivalent:
npm run migrate:wp:snapshot -- /path/to/capture.json
```

Both paths in the capture config resolve relative to that config. The snapshot
destination must not exist; capture never merges or resumes. The existing WXR
validator runs before any WordPress request or snapshot creation. A verified
copy is packaged; the original WXR remains untouched. There is no backup-bypass
flag for capture. All authenticated requests require HTTPS. Redirects are
refused, and off-origin media receives no WordPress credentials.

Capture discovers `/wp-json`, `/wp-json/wp/v2/types?context=edit`, and
`/wp-json/wp/v2/taxonomies?context=edit`. The core discovery namespace is
`/wp-json/wp/v2`; discovered types/taxonomies may use their own namespaces.
It captures posts, pages, media, categories, tags, users, and discovered
REST-exposed post types/taxonomies regardless of the migration's `contentTypes`,
`includeDrafts`, `downloadMedia`, and `dryRun` settings. Requests use
`context=edit`, `_embed=1`, `per_page=100`, and successive `page` values.
Content/media status lists come from the discovered GET schema, excluding
`any` when explicit statuses exist. If no status enum is exposed, capture uses
`any` and records `status-scope-unverified` as incompleteness. Permission failures
never fall back to public REST. Pagination requires total/page-count headers,
stable totals, unique positive IDs, and the expected final record count.

Exit status: **0** for `complete`, **2** for either other completeness state,
**1** for a fatal config/preflight/filesystem error. The command prints the
manifest path and completeness state. A checkpoint manifest starts as
`incomplete` and stays that way if interrupted.

## Directory contract

```text
source-snapshot/
  manifest.json
  manifest.sha256
  backup/source.xml
  discovery/root.json
  discovery/types.json
  discovery/taxonomies.json
  records/<REST namespace>/<REST base>/page-<number>.json
  assets/<attachment ID>/<SHA-256 of confirmed URL><source extension>
```

Each page file is a JSON array of **whole returned records**, including unknown
plugin fields, metadata, embedded relations, raw/rendered content, and translation
fields. Serialization preserves JSON values, not response whitespace. Discovery
files likewise preserve whole JSON objects. Failed discovery/pages are absent
and recorded in the manifest; earlier successful pages remain. A response
containing recognized secret fields, credential-bearing URLs, or the active
credential is refused whole, with a stable failure code, rather than reduced
or redacted into a misleading partial record. Errors never include REST response
bodies or transport exception text.

Manifest paths are always relative to the snapshot root. Checksums are SHA-256;
`manifest.sha256` contains the hexadecimal checksum of `manifest.json` plus a
newline. `files` covers every packaged data file except the manifest and its
checksum sidecar. Readers verify checksums, byte counts, regular files, and path
containment (including symlinks). These hashes detect damage; they are not
cryptographic signatures authenticating a publisher.

### Manifest fields

| Field | Contract |
| --- | --- |
| `schemaVersion` | Integer `1`; unsupported versions are refused. |
| `kind` | `wordpress-rest-snapshot`. |
| `capturedAt`, `finishedAt` | ISO timestamps; `finishedAt` is null until capture finishes. |
| `sourceBaseUrl` | Credential-free HTTPS WordPress base URL. |
| `restNamespace` | Core discovery namespace, `/wp-json/wp/v2`. |
| `scope` | Describes the REST content/media scope; excludes a full database/theme/plugin-runtime backup. |
| `discovery` | `root`, `types`, `taxonomies` → relative JSON paths for successful discovery requests. |
| `xmlBackup` | `status`, relative `filename`, `sizeBytes`, `sha256`, `verifiedAt`, reusing existing WXR verification. |
| `files` | Relative path → `{byteCount, sha256}`. |
| `collections[]` | `{kind, name, restBase, route, context, count, expectedCount, pages, status, contentForms}`, optional `statuses` and `failure`. |
| `collections[].kind` | `content`, `media`, `taxonomy`, or `users`. |
| `collections[].pages[]` | `{file, page, total, totalPages, count}`; all totals originate from pagination headers. |
| `collections[].status` | `complete` or `incomplete`; `failure` is a stable diagnostic code. |
| `collections[].contentForms` | Counts `raw`, `rendered`, `both`, `neither`, `rawOnly`, `renderedOnly` for the `content` field. Empty strings count as available. |
| `media` | Attachment ID → `{record, files}`; `record` is the entire authoritative REST attachment, not a derived URL or a partial schema. |
| `media[id].files[]` | `{role, url, mimeType, status, localPath, byteCount, sha256}`, plus `failure` when unsuccessful. `role` is `source` or `size:<name>`. |
| `unresolvedMedia[]` | `{sourceId, collection, attachmentId or url, reason}`; records references without an authoritative attachment/file match. |
| `completeness` | `{status, reasons, counts}` as described below. |

The content-form counts describe availability, not authority. Capture never
chooses between raw and rendered content. Analyze retains its existing raw-first
inspection; migration retains its existing rendered-first transformation and
uses raw when rendered is absent. Both use the same shortcode/WPBakery,
frontmatter, diagnostics, and output code as live REST.

### Offline completeness

- **`complete`**: required discovery and all discovered collections captured;
  status scope verified; every explicit attachment source/size file downloaded
  and validated; no detected unresolved media references.
- **`complete-with-unresolved-media`**: collection/file capture succeeded, but
  content references an attachment ID absent from the media collection or a
  media URL absent from authoritative media records. No speculative request is
  made. This state does **not** claim that all content media works offline.
- **`incomplete`**: discovery, pagination, status scope, secret screening, or
  confirmed media capture/validation failed. Earlier data and authoritative
  metadata are retained wherever safely available.

`completeness.reasons[]` contains `{code, count}` and the relevant `discovery`,
`collection`, or `attachmentId`/`role`. `counts` contains `collections`,
`failedCollections`, `records`, `attachments`, `mediaFiles`,
`downloadedMediaFiles`, `failedMediaFiles`, and `unresolvedMediaReferences`.
Per-file failure codes distinguish HTTP status, MIME mismatch, empty response,
byte-count mismatch, unsupported URL, missing MIME, secret material, and other
fetch/validation failures. A failed file has null local path/byte count/checksum;
its confirmed URL and record remain available unless secret screening forbids
persisting the source response. No ID-derived URL is ever constructed.

Detected references include raw/rendered content and excerpts, WPBakery image
IDs, featured IDs, image/video/source attributes, srcsets, lazy media attributes,
CSS URL values and supported JSON media fields. An arbitrary plugin's encoded
runtime references cannot be exhaustively inventoried. Completeness describes
this declared REST package scope, not a guarantee of static rendering parity,
an atomic database snapshot, or visibility beyond the authenticated account's
REST permissions. Take the WXR backup and capture while source content is stable.

## Offline analyze and migration

```json
{
  "sourceType": "snapshot",
  "snapshotPath": "./source-snapshot",
  "contentTypes": "posts,pages,books",
  "analysisOutputDir": "./analysis",
  "outputRoot": "/absolute/path/to/new-eleventy-output",
  "downloadMedia": true,
  "dryRun": false
}
```

```sh
node src/main.mjs analyze /path/to/offline.json
node src/main.mjs run /path/to/offline.json
```

`snapshotPath` and `analysisOutputDir` resolve relative to config. `outputRoot`
retains the migration convention (relative to the working directory); use an
absolute path to avoid ambiguity. It must be a new directory. Content types can
use REST base names, discovery names, or full REST routes when ambiguous.
Move the entire snapshot directory, including `backup/`, `manifest.sha256`, and
assets; update only `snapshotPath`. No original config, credentials, original WXR
location, or reachable WordPress server is needed.

Both commands revalidate the packaged WXR, even if analyze's legacy
`--skip-xml-backup` option is supplied. Neither command makes network calls.
Menu/style fetching, language detection, and automatic dependency installation
are skipped and reported. REST navigation records may be preserved by discovery,
but theme HTML/styles and plugin runtime behavior are outside this package's
scope. Eleventy scaffolding is generated by the existing pipeline; install its
dependencies separately when you choose to build it.

Incomplete selected content/taxonomy collections and damaged JSON/WXR fail
closed before migration output. Incomplete media permits analysis/migration with
explicit `snapshot` completeness/reasons/counts in reports (also in the write
plan). Missing/corrupt local assets add `local-media-missing-or-corrupt` reasons
and `counts.localMediaFailures`; failed destination copies/collisions add
`counts.localMediaCopyFailures`. The source manifest is never rewritten by readers.
Only successfully copied, checksum-verified media gets a local URL. Failed
ordinary/featured URLs remain as source references; failed WPBakery attachment
IDs use the existing unresolved-media placeholder and transformer diagnostic.
There is no network retry or guessed local URL. `downloadMedia: false` and
`dryRun: true` retain the existing attachment-resolution restrictions.

Live `sourceType: rest` remains available with its existing behavior. No live
credential/config workflow or unrelated transformer is changed by this feature.
