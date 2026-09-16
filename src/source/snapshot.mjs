import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifyXmlBackup } from "./wxr.mjs";
import { mediaDestination } from "../media/attachment-resolver.mjs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Filesystem-only source. This module has no network transport or fallback. */
export async function openSnapshot(config, configDir = process.cwd()) {
  if (!config.snapshotPath) throw new Error("snapshotPath is required for sourceType snapshot.");
  const root = await fs.realpath(path.resolve(configDir, config.snapshotPath));
  async function localPath(relative) {
    if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Unsafe snapshot path.");
    const resolved = await fs.realpath(path.join(root, relative));
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Snapshot file escapes its directory.");
    if (!(await fs.stat(resolved)).isFile()) throw new Error("Snapshot entry is not a regular file.");
    return resolved;
  }
  const bytes = await fs.readFile(await localPath("manifest.json"));
  const digest = (await fs.readFile(await localPath("manifest.sha256"), "utf8")).trim();
  if (sha256(bytes) !== digest) throw new Error("Snapshot manifest checksum mismatch.");
  const manifest = JSON.parse(bytes);
  if (manifest.schemaVersion !== 1 || manifest.kind !== "wordpress-rest-snapshot" || !Array.isArray(manifest.collections)
    || !manifest.files || !manifest.media || !["complete", "complete-with-unresolved-media", "incomplete"].includes(manifest.completeness?.status)) throw new Error("Unsupported or invalid snapshot manifest.");
  async function checked(relative) {
    const expected = manifest.files[relative];
    if (!expected) throw new Error("Snapshot file has no checksum.");
    const absolute = await localPath(relative);
    const bytes = await fs.readFile(absolute);
    if (bytes.length !== expected.byteCount || sha256(bytes) !== expected.sha256) throw new Error("Snapshot file checksum mismatch.");
    return { bytes, absolute };
  }
  await checked(manifest.xmlBackup?.filename);
  const xmlBackup = await verifyXmlBackup(manifest.xmlBackup.filename, root);
  if (xmlBackup.sha256 !== manifest.xmlBackup.sha256) throw new Error("Snapshot WXR checksum mismatch.");
  for (const file of Object.values(manifest.discovery || {})) await checked(file);
  const collections = new Map();
  for (const collection of manifest.collections) {
    const items = [];
    for (const page of collection.pages) {
      const records = JSON.parse((await checked(page.file)).bytes);
      if (!Array.isArray(records) || records.length !== page.count) throw new Error("Invalid snapshot collection page.");
      items.push(...records);
    }
    if (items.length !== collection.count) throw new Error("Invalid snapshot collection count.");
    collections.set(collection.route, { collection, items });
  }
  const assets = new Map();
  const assetFailures = [];
  for (const [id, media] of Object.entries(manifest.media)) {
    if (String(media.record?.id) !== id) throw new Error("Invalid snapshot attachment identity.");
    for (const file of media.files) {
      if (file.status !== "complete") continue;
      try {
        const { absolute, bytes } = await checked(file.localPath);
        if (bytes.length !== file.byteCount || sha256(bytes) !== file.sha256) throw new Error();
        assets.set(new URL(file.url).href, { ...file, absolute });
      } catch { assetFailures.push({ code: "local-media-missing-or-corrupt", attachmentId: Number(id), role: file.role, count: 1 }); }
    }
  }
  const completeness = structuredClone(manifest.completeness);
  if (assetFailures.length) {
    completeness.status = "incomplete";
    completeness.reasons.push(...assetFailures);
    completeness.counts.localMediaFailures = assetFailures.length;
  }
  function collectionFor(type) {
    const matches = [...collections.values()].filter(({ collection }) => [collection.restBase, collection.name, collection.route].includes(type));
    if (matches.length !== 1) throw new Error("Snapshot collection missing or ambiguous; use its full route.");
    if (matches[0].collection.status !== "complete") throw new Error("Requested snapshot collection is incomplete.");
    return matches[0];
  }
  const blockedUrls = new Set();
  const source = {
    manifest, completeness, xmlBackup,
    baseUrl: manifest.sourceBaseUrl,
    collection: (type) => structuredClone(collectionFor(type).items),
    context: (type) => collectionFor(type).collection.context,
    lookupMedia: async (id) => structuredClone(manifest.media[id]?.record || null),
    async copyMedia(url, outPath, mime) {
      const file = assets.get(url);
      if (!file || blockedUrls.has(url) || (mime && file.mimeType !== mime)) throw new Error("Snapshot media unavailable.");
      // Recheck immediately before copying, so a changed package cannot publish
      // a corrupt asset after source validation.
      const { bytes } = await checked(file.localPath);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, bytes);
    },
    async prepareMedia(mediaRoot, mediaDir, sanitizeFileSegment) {
      const map = new Map();
      const owners = new Map();
      const failures = [];
      const destinations = new Map();
      for (const [url] of assets) {
        try {
          const destination = mediaDestination(url, manifest.sourceBaseUrl, mediaRoot, mediaDir, sanitizeFileSegment);
          const previous = owners.get(destination.outPath);
          if (previous && previous !== url) {
            blockedUrls.add(previous);
            blockedUrls.add(url);
          }
          owners.set(destination.outPath, url);
          destinations.set(url, destination);
        } catch { blockedUrls.add(url); }
      }
      for (const [url] of assets) {
        try {
          const { outPath, localUrl } = destinations.get(url) || {};
          await source.copyMedia(url, outPath);
          map.set(url, localUrl);
        } catch { failures.push({ code: blockedUrls.has(url) ? "media-path-collision-or-invalid" : "local-media-copy-failed", url, count: 1 }); }
      }
      // Match URL tokens as a whole: prefix replacement can corrupt srcset
      // variants and query strings. Include root-relative and escaped HTML URLs.
      const aliases = new Map(map);
      for (const [url, local] of map) {
        aliases.set(assets.get(url).url, local);
        aliases.set(url.replaceAll("&", "&amp;"), local);
        const parsed = new URL(url);
        if (parsed.origin === new URL(manifest.sourceBaseUrl).origin) aliases.set(`${parsed.pathname}${parsed.search}`, local);
      }
      const rewrite = (text) => String(text || "").replace(/https?:\/\/[^\s"'<>()[\]]+|\/[^\s"'<>()[\]]+/g, (token) => aliases.get(token) || token);
      return { rewrite, failures };
    }
  };
  return source;
}
