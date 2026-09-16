import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const IMAGE_MIMES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
  "image/svg+xml", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon"
]);

export function attachmentId(value) {
  const text = String(value ?? "").trim();
  const id = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Engine-owned preparation performs I/O. The transformer receives only the
// synchronous lookups below: a confirmed local { url, alt, caption, mime } or
// null, plus a stable failure code. No source URL or request error is reported.
export function createAttachmentResolver({
  wpBaseUrl, mediaRoot, mediaDir, downloadMedia, dryRun,
  lookupMedia, downloadFile, sanitizeFileSegment
}) {
  const records = new Map();
  const resolved = new Map();
  const failures = new Map();
  const downloaded = new Map();
  const destinations = new Map();
  const origin = new URL(wpBaseUrl).origin;

  async function prepare(ids, embeddedRecords = []) {
    for (const record of embeddedRecords) {
      const id = attachmentId(record?.id);
      if (id && record?.source_url && record?.mime_type) records.set(id, record);
    }
    for (const id of new Set(ids.map(attachmentId).filter(Boolean))) {
      if (resolved.has(id) || failures.has(id)) continue;
      if (!downloadMedia || dryRun) {
        failures.set(id, dryRun ? "dry-run" : "downloads-disabled");
        continue;
      }
      let record = records.get(id);
      if (!record) {
        try {
          record = await lookupMedia(id);
        } catch {
          failures.set(id, "lookup-failed");
          continue;
        }
      }
      if (!record || attachmentId(record.id) !== id || !record.source_url) {
        failures.set(id, "record-missing-or-invalid");
        continue;
      }
      if (!IMAGE_MIMES.has(record.mime_type)) {
        failures.set(id, "unsupported-media-type");
        continue;
      }
      let source;
      try {
        source = new URL(record.source_url);
        if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Error();
      } catch {
        failures.set(id, "unsupported-media-url");
        continue;
      }
      // Keep the existing URL-path/sanitized-segment convention. Authoritative
      // off-origin records get their own namespace, and never WP credentials.
      const segments = source.pathname.replace(/^\/+/, "").split("/").map(sanitizeFileSegment);
      if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        failures.set(id, "unsupported-media-path");
        continue;
      }
      if (source.origin !== origin) segments.unshift("_external", sanitizeFileSegment(source.host));
      const outPath = path.join(mediaRoot, ...segments);
      const localUrl = `/${mediaDir}/${segments.join("/")}`.replace(/\/+/g, "/");
      const owner = destinations.get(outPath);
      if (owner && owner !== source.href) {
        failures.set(id, "media-path-collision");
        continue;
      }
      destinations.set(outPath, source.href);
      if (!downloaded.has(source.href)) {
        // Do not treat an arbitrary existing file as an established ID mapping.
        // Publish the destination only after a complete, non-empty download.
        const temporaryPath = `${outPath}.${randomUUID()}.part`;
        try {
          await downloadFile(source.href, temporaryPath, record.mime_type);
          const stat = await fs.stat(temporaryPath);
          if (!stat.isFile() || stat.size === 0) throw new Error();
          await fs.rename(temporaryPath, outPath);
          downloaded.set(source.href, localUrl);
        } catch {
          failures.set(id, "download-failed");
          continue;
        } finally {
          await fs.rm(temporaryPath, { force: true });
        }
      }
      resolved.set(id, Object.freeze({
        url: downloaded.get(source.href),
        alt: typeof record.alt_text === "string" ? record.alt_text : "",
        caption: typeof record.caption?.rendered === "string" ? record.caption.rendered : "",
        mime: record.mime_type
      }));
    }
  }

  return {
    prepare,
    resolveMediaById: (id) => resolved.get(attachmentId(id)) || null,
    unresolvedMediaReason: (id) => failures.get(attachmentId(id)) || "media-id-unresolved"
  };
}
