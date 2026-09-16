import fs from "node:fs/promises";
import path from "node:path";

// Strict capture uses the same transport as live migration, with fail-closed
// pagination, no redirects, and errors that never contain response bodies.
export async function fetchAllPages(url, headers = {}, options = {}) {
  const all = [];
  const ids = new Set();
  let page = 1;
  let expectedTotal;
  let expectedPages;
  while (true) {
    const finalUrl = `${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`;
    const res = await fetch(finalUrl, { headers, ...(options.strict ? { redirect: "error" } : {}) });
    if (!res.ok) {
      if (options.strict) throw new Error(`rest-http-${res.status}`);
      if (res.status === 400 && page > 1) break;
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} for ${finalUrl}\n${body.slice(0, 300)}`);
    }
    const part = await res.json();
    const totalPages = Number(res.headers.get("x-wp-totalpages") || "0");
    if (options.strict) {
      const total = Number(res.headers.get("x-wp-total"));
      if (!Array.isArray(part) || !res.headers.has("x-wp-total") || !res.headers.has("x-wp-totalpages")
        || !Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(totalPages) || totalPages < 0
        || (total > 0 && (totalPages === 0 || part.length === 0)) || part.length > 100) throw new Error("invalid-pagination");
      if (page > 1 && (total !== expectedTotal || totalPages !== expectedPages)) throw new Error("collection-changed-during-capture");
      expectedTotal = total;
      expectedPages = totalPages;
      for (const record of part) {
        if (!Number.isSafeInteger(record?.id) || record.id <= 0 || ids.has(record.id)) throw new Error("invalid-or-duplicate-record-id");
        ids.add(record.id);
      }
      await options.onPage?.(part, { page, total, totalPages });
    }
    if (!Array.isArray(part) || part.length === 0) break;
    all.push(...part);
    if (totalPages > 0 && page >= totalPages) break;
    page += 1;
  }
  if (options.strict && all.length !== expectedTotal) throw new Error("collection-count-mismatch");
  return all;
}

export async function fetchJson(url, headers = {}, options = {}) {
  const res = await fetch(url, { headers, ...(options.strict ? { redirect: "error" } : {}) });
  if (!res.ok) {
    if (options.strict) throw new Error(`rest-http-${res.status}`);
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function downloadFile(url, outPath, headers = {}, expectedMime = "", options = {}) {
  const res = await fetch(url, { headers, ...(options.strict ? { redirect: "error" } : {}) });
  if (!res.ok) throw new Error(options.strict ? `media-http-${res.status}` : `Failed media download: ${res.status} ${url}`);
  if (expectedMime && res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== expectedMime) {
    throw new Error(options.strict ? "media-mime-mismatch" : "Unexpected attachment media content type");
  }
  const arr = new Uint8Array(await res.arrayBuffer());
  if (expectedMime && !arr.byteLength) throw new Error(options.strict ? "media-empty-response" : "Empty attachment media response");
  const length = res.headers.get("content-length");
  if (options.strict && length !== null && !res.headers.get("content-encoding") && Number(length) !== arr.byteLength) {
    throw new Error("media-byte-count-mismatch");
  }
  await options.validateBytes?.(arr);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, arr);
}
