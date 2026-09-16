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
  lookupMedia, listMedia, downloadFile, sanitizeFileSegment
}) {
  const records = new Map();
  const resolved = new Map();
  const failures = new Map();
  const downloaded = new Map();
  const destinations = new Map();
  const byUrl = new Map();
  const urlFailures = new Map();
  const localUrls = new Set();
  let libraryLoaded = false;
  let libraryFailed = false;
  const origin = new URL(wpBaseUrl).origin;

  function indexRecord(record) {
    const id = attachmentId(record?.id);
    if (!id || !record?.source_url || !record?.mime_type) return;
    records.set(id, record);
    for (const variant of [record, ...Object.values(record.media_details?.sizes || {})]) {
      if (!variant?.source_url) continue;
      try {
        const url = new URL(variant.source_url).href;
        byUrl.set(url, { source_url: url, mime_type: variant.mime_type || record.mime_type });
      } catch { /* Invalid source URLs are never inferred from filenames. */ }
    }
  }

  async function transfer(record) {
    const key = record.source_url;
    if (!IMAGE_MIMES.has(record.mime_type)) {
      urlFailures.set(key, "unsupported-media-type");
      return null;
    }
    let source;
    try {
      source = new URL(record.source_url);
      if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Error();
    } catch {
      urlFailures.set(key, "unsupported-media-url");
      return null;
    }
    // Keep the existing URL-path/sanitized-segment convention. Authoritative
    // off-origin records get their own namespace, and never WP credentials.
    const segments = source.pathname.replace(/^\/+/, "").split("/").map(sanitizeFileSegment);
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      urlFailures.set(key, "unsupported-media-path");
      return null;
    }
    if (source.origin !== origin) segments.unshift("_external", sanitizeFileSegment(source.host));
    const outPath = path.join(mediaRoot, ...segments);
    const localUrl = `/${mediaDir}/${segments.join("/")}`.replace(/\/+/g, "/");
    const owner = destinations.get(outPath);
    if (owner && owner !== source.href) {
      urlFailures.set(key, "media-path-collision");
      return null;
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
        localUrls.add(localUrl);
      } catch {
        urlFailures.set(key, "download-failed");
        return null;
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
      }
    }
    return downloaded.get(source.href);
  }

  async function prepare(ids, embeddedRecords = []) {
    for (const record of embeddedRecords) indexRecord(record);
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
      indexRecord(record);
      const url = await transfer(record);
      if (!url) {
        failures.set(id, urlFailures.get(record.source_url) || "download-failed");
        continue;
      }
      resolved.set(id, Object.freeze({
        url,
        alt: typeof record.alt_text === "string" ? record.alt_text : "",
        caption: typeof record.caption?.rendered === "string" ? record.caption.rendered : "",
        mime: record.mime_type
      }));
    }
  }

  async function prepareUrls(urls) {
    for (const value of new Set(urls)) {
      let url;
      try {
        url = new URL(value);
        if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) throw new Error();
      } catch {
        urlFailures.set(value, "unsupported-media-url");
        continue;
      }
      const key = url.href;
      if (url.origin !== origin) {
        urlFailures.set(key, "external-media");
        continue;
      }
      if (downloaded.has(key) || urlFailures.has(key)) continue;
      if (!downloadMedia || dryRun) {
        urlFailures.set(key, dryRun ? "dry-run" : "downloads-disabled");
        continue;
      }
      if (!byUrl.has(key) && !libraryLoaded) {
        libraryLoaded = true;
        try {
          if (!listMedia) throw new Error();
          const library = await listMedia();
          if (!Array.isArray(library)) throw new Error();
          for (const record of library) indexRecord(record);
        } catch { libraryFailed = true; }
      }
      const record = byUrl.get(key);
      if (!record) {
        urlFailures.set(key, libraryFailed ? "media-library-lookup-failed" : "unverified-media-url");
        continue;
      }
      await transfer(record);
    }
  }

  return {
    prepare,
    prepareUrls,
    isLocalMediaUrl: (url) => localUrls.has(url),
    resolveMediaUrl: (url) => {
      try { return new URL(url).origin === origin ? downloaded.get(new URL(url).href) || null : null; }
      catch { return null; }
    },
    unresolvedMediaUrlReason: (url) => urlFailures.get(url) || "unverified-media-url",
    resolveMediaById: (id) => resolved.get(attachmentId(id)) || null,
    unresolvedMediaReason: (id) => failures.get(attachmentId(id)) || "media-id-unresolved"
  };
}
