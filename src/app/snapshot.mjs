import fs from "node:fs/promises";
import path from "node:path";
import { createConfigFromInput } from "../config/normalize.mjs";
import { verifyXmlBackup } from "../source/wxr.mjs";
import { sha256 } from "../source/snapshot.mjs";
import { fetchJson, fetchAllPages, downloadFile } from "../fetch/rest.mjs";
import { mediaReferences } from "../source/media-references.mjs";
import { collectWpBakeryMediaIds } from "../blocks/page-builders/wpbakery.mjs";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const stableFailure = (err, fallback) => /^(rest-http-\d+|invalid-pagination|collection-changed-during-capture|invalid-or-duplicate-record-id|collection-count-mismatch|secret-material-detected)$/.test(err?.message) ? err.message : fallback;

function safeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("unsupported-url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || [...url.searchParams.keys()].some((key) => /password|token|secret|credential|signature|api.?key/i.test(key))) throw new Error("unsupported-url");
  return url;
}

// Reject secret-bearing responses rather than silently rewriting original data.
function secretGuard(secrets) {
  return (value, schemaData = false) => {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (secrets.some((secret) => secret && serialized.includes(secret))) throw new Error("secret-material-detected");
    if (typeof value === "string") {
      const inner = (text) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
      for (const match of value.matchAll(/<wp:post_password>([\s\S]*?)<\/wp:post_password>/gi)) {
        if (inner(match[1])) throw new Error("secret-material-detected");
      }
      for (const match of value.matchAll(/<wp:meta_key>([\s\S]*?)<\/wp:meta_key>\s*<wp:meta_value>([\s\S]*?)<\/wp:meta_value>/gi)) {
        if (/password|token|secret|credential|api.?key/i.test(inner(match[1])) && inner(match[2])) throw new Error("secret-material-detected");
      }
    }
    const visit = (node) => {
      if (typeof node === "string") {
        for (const match of node.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
          try {
            const url = new URL(match[0]);
            if (url.username || url.password || [...url.searchParams.keys()].some((key) => /password|token|secret|credential|signature|api.?key/i.test(key))) throw new Error("secret-material-detected");
          } catch (err) { if (err.message === "secret-material-detected") throw err; }
        }
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const [key, child] of Object.entries(node)) {
        if (/password|token|secret|credential|api.?key/i.test(key) && child && typeof child !== "boolean" && (!schemaData || typeof child === "string")) throw new Error("secret-material-detected");
        if (/authorization/i.test(key) && typeof child === "string" && /^(Basic|Bearer) /i.test(child)) throw new Error("secret-material-detected");
        visit(child);
      }
    };
    visit(value);
  };
}

/** Read-only WordPress capture. Config and credentials are never persisted. */
export async function runSnapshot(configPath) {
  const absolute = path.resolve(configPath);
  const configDir = path.dirname(absolute);
  const raw = JSON.parse(await fs.readFile(absolute, "utf8"));
  if (raw.wpAppPassword || raw.wpBearerToken || raw.wpUser) throw new Error("Snapshot credentials must come from WP_USER and WP_APP_PASSWORD, not config.");
  const config = await createConfigFromInput(raw);
  if (config.sourceType !== "rest" || config.authMode !== "app-password") throw new Error("Snapshot requires sourceType rest and authMode app-password.");
  let base;
  try { base = safeUrl(config.wpBaseUrl); if (base.search) throw new Error(); }
  catch { throw new Error("Snapshot requires a credential-free HTTPS WordPress base URL."); }
  const wpUser = process.env.WP_USER;
  const wpAppPassword = process.env.WP_APP_PASSWORD;
  if (!wpUser || !wpAppPassword) throw new Error("Snapshot requires WP_USER and WP_APP_PASSWORD in the environment.");
  if (!config.xmlBackupPath) throw new Error("xmlBackupPath is required for snapshot capture; the WXR preflight cannot be skipped.");
  if (!config.snapshotOutputDir) throw new Error("snapshotOutputDir is required and must name a new directory.");
  const backup = await verifyXmlBackup(config.xmlBackupPath, configDir);
  const { buildAuthHeaders } = await import("../../scripts/wp-eleventy-migrate.mjs");
  const headers = buildAuthHeaders({ authMode: "app-password", wpUser, wpAppPassword });
  const guard = secretGuard([wpAppPassword, wpAppPassword.replace(/\s/g, ""), headers.Authorization, headers.Authorization.slice(6)]);
  const backupBytes = await fs.readFile(backup.filename);
  guard(backupBytes.toString("utf8"));
  if (config.restNamespace !== "/wp-json/wp/v2") throw new Error("Snapshot discovery requires restNamespace /wp-json/wp/v2; discovered custom namespaces are captured automatically.");
  const root = path.resolve(configDir, config.snapshotOutputDir);
  await fs.mkdir(root); // No merging, overwriting, or resumptions of old captures.
  const manifest = {
    schemaVersion: 1, kind: "wordpress-rest-snapshot", capturedAt: new Date().toISOString(),
    finishedAt: null, sourceBaseUrl: base.href.replace(/\/$/, ""), restNamespace: config.restNamespace,
    scope: "Authenticated REST-exposed content, taxonomies, users and confirmed attachment files; no atomic database, theme or plugin-runtime backup.",
    discovery: {}, collections: [], media: {}, unresolvedMedia: [], files: {},
    xmlBackup: { ...backup, filename: "backup/source.xml" },
    completeness: { status: "incomplete", reasons: [{ code: "capture-in-progress", count: 1 }], counts: {} }
  };
  async function save(relative, data) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), bytes);
    manifest.files[relative] = { byteCount: bytes.length, sha256: sha256(bytes) };
  }
  async function checkpoint() {
    const bytes = json(manifest);
    await fs.writeFile(path.join(root, "manifest.json"), bytes);
    await fs.writeFile(path.join(root, "manifest.sha256"), `${sha256(bytes)}\n`);
  }
  await save("backup/source.xml", backupBytes);
  await checkpoint();
  const reasons = [];
  const discovery = {};
  const restRoot = `${manifest.sourceBaseUrl}/wp-json`;
  for (const [name, endpoint] of [["root", restRoot], ["types", `${restRoot}/wp/v2/types?context=edit`], ["taxonomies", `${restRoot}/wp/v2/taxonomies?context=edit`]]) {
    try {
      const record = await fetchJson(endpoint, headers, { strict: true });
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error();
      guard(record, true);
      discovery[name] = record;
      manifest.discovery[name] = `discovery/${name}.json`;
      await save(manifest.discovery[name], json(record));
    } catch (err) { reasons.push({ code: stableFailure(err, "discovery-failed"), discovery: name, count: 1 }); }
  }
  const collections = new Map();
  const add = (kind, name, restBase, namespace = "wp/v2") => {
    if (!restBase) return;
    const route = `/${namespace}/${restBase}`;
    if (!/^\/[a-zA-Z0-9_/-]+$/.test(route) || route.includes("..")) {
      reasons.push({ code: "unsupported-collection-route", collection: name, count: 1 }); return;
    }
    for (const [previousRoute, previous] of collections) {
      if (previous.name === name && previous.kind === kind && previousRoute !== route) collections.delete(previousRoute);
    }
    collections.set(route, { kind, name, restBase, route });
  };
  add("content", "post", "posts"); add("content", "page", "pages");
  add("media", "attachment", "media"); add("taxonomy", "category", "categories");
  add("taxonomy", "post_tag", "tags"); add("users", "user", "users");
  for (const [name, info] of Object.entries(discovery.types || {})) add(name === "attachment" ? "media" : "content", name, info?.rest_base, info?.rest_namespace);
  for (const [name, info] of Object.entries(discovery.taxonomies || {})) add("taxonomy", name, info?.rest_base, info?.rest_namespace);
  const records = new Map();
  for (const spec of collections.values()) {
    const collection = { ...spec, context: "edit", count: 0, expectedCount: null, pages: [], status: "incomplete", contentForms: { raw: 0, rendered: 0, both: 0, neither: 0, rawOnly: 0, renderedOnly: 0 } };
    manifest.collections.push(collection);
    const params = new URLSearchParams({ context: "edit", _embed: "1" });
    if (["content", "media"].includes(spec.kind)) {
      const endpoints = discovery.root?.routes?.[spec.route]?.endpoints || [];
      const statusArg = endpoints.find((e) => e.methods?.includes("GET"))?.args?.status;
      const statuses = (statusArg?.items?.enum || statusArg?.enum || []).filter((s) => s !== "any");
      params.set("status", statuses.length ? statuses.join(",") : "any");
      collection.statuses = statuses.length ? statuses : ["any"];
      if (!statuses.length) reasons.push({ code: "status-scope-unverified", collection: spec.route, count: 1 });
    }
    const captured = [];
    records.set(spec.route, captured);
    try {
      await fetchAllPages(`${restRoot}${spec.route}?${params}`, headers, { strict: true, onPage: async (items, pagination) => {
        guard(items);
        const file = `records/${spec.route.slice(1)}/page-${pagination.page}.json`;
        await save(file, json(items));
        collection.pages.push({ file, ...pagination, count: items.length });
        collection.expectedCount = pagination.total;
        captured.push(...items);
        collection.count += items.length;
        for (const item of items) {
          const raw = typeof item.content?.raw === "string";
          const rendered = typeof item.content?.rendered === "string";
          if (raw) collection.contentForms.raw++;
          if (rendered) collection.contentForms.rendered++;
          if (raw && rendered) collection.contentForms.both++;
          else if (!raw && !rendered) collection.contentForms.neither++;
          else collection.contentForms[raw ? "rawOnly" : "renderedOnly"]++;
        }
      } });
      collection.status = "complete";
    } catch (err) {
      collection.failure = stableFailure(err, "collection-fetch-failed");
      reasons.push({ code: collection.failure, collection: spec.route, count: 1 });
    }
    await checkpoint();
  }
  for (const collection of manifest.collections.filter((c) => c.kind === "media")) {
    for (const record of records.get(collection.route)) {
      const id = String(record.id);
      const entry = { record, files: [] };
      manifest.media[id] = entry;
      const candidates = [{ role: "source", url: record.source_url || null, mimeType: record.mime_type || null }, ...Object.entries(record.media_details?.sizes || {}).map(([name, size]) => ({ role: `size:${name}`, url: size?.source_url || null, mimeType: size?.mime_type || record.mime_type || null }))];
      for (const candidate of candidates) {
        if (entry.files.some((f) => f.url === candidate.url)) continue;
        const file = { ...candidate, status: "failed", localPath: null, byteCount: null, sha256: null };
        entry.files.push(file);
        let target;
        try {
          const url = safeUrl(candidate.url);
          if (!candidate.mimeType || typeof candidate.mimeType !== "string") throw new Error("media-mime-missing");
          const ext = path.extname(url.pathname).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 12);
          const relative = `assets/${id}/${sha256(url.href)}${ext}`;
          target = path.join(root, relative);
          await downloadFile(url.href, target, url.origin === base.origin ? headers : {}, candidate.mimeType, { strict: true, validateBytes: (bytes) => guard(Buffer.from(bytes).toString("utf8")) });
          const bytes = await fs.readFile(target);
          file.localPath = relative; file.byteCount = bytes.length; file.sha256 = sha256(bytes); file.status = "complete";
          manifest.files[relative] = { byteCount: bytes.length, sha256: file.sha256 };
        } catch (err) {
          if (target) await fs.rm(target, { force: true });
          file.failure = /^(media-http-\d+|media-mime-mismatch|media-mime-missing|media-empty-response|media-byte-count-mismatch|unsupported-url|secret-material-detected)$/.test(err?.message)
            ? err.message : "media-fetch-or-validation-failed";
          reasons.push({ code: file.failure, attachmentId: record.id, role: candidate.role, count: 1 });
        }
      }
    }
  }
  const knownUrls = new Set(Object.values(manifest.media).flatMap((m) => m.files.map((f) => {
    try { return new URL(f.url).href; } catch { return null; }
  })));
  for (const collection of manifest.collections.filter((c) => c.kind === "content")) {
    for (const record of records.get(collection.route)) {
      const text = [record.content?.raw, record.content?.rendered, record.excerpt?.raw, record.excerpt?.rendered].filter((v) => typeof v === "string").join("\n");
      const ids = new Set(collectWpBakeryMediaIds(text));
      if (record.featured_media) ids.add(record.featured_media);
      for (const id of ids) if (!manifest.media[id]) manifest.unresolvedMedia.push({ sourceId: record.id, collection: collection.route, attachmentId: id, reason: "attachment-record-missing" });
      for (const url of mediaReferences(text, manifest.sourceBaseUrl)) if (!knownUrls.has(url)) manifest.unresolvedMedia.push({ sourceId: record.id, collection: collection.route, url, reason: "url-not-in-media-records" });
    }
  }
  const files = Object.values(manifest.media).flatMap((m) => m.files);
  manifest.finishedAt = new Date().toISOString();
  manifest.completeness = {
    status: reasons.length ? "incomplete" : manifest.unresolvedMedia.length ? "complete-with-unresolved-media" : "complete",
    reasons: [...reasons, ...(manifest.unresolvedMedia.length ? [{ code: "unresolved-media-references", count: manifest.unresolvedMedia.length }] : [])],
    counts: { collections: manifest.collections.length, failedCollections: manifest.collections.filter((c) => c.status !== "complete").length,
      records: manifest.collections.reduce((n, c) => n + c.count, 0), attachments: Object.keys(manifest.media).length,
      mediaFiles: files.length, downloadedMediaFiles: files.filter((f) => f.status === "complete").length,
      failedMediaFiles: files.filter((f) => f.status !== "complete").length, unresolvedMediaReferences: manifest.unresolvedMedia.length }
  };
  await checkpoint();
  return { snapshotDir: root, manifestPath: path.join(root, "manifest.json"), manifest };
}
