import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const WXR_HINTS = [
  "<?xml",
  "wp:wxr_version",
  "xmlns:wp=",
  "xmlns:content=",
  "xmlns:excerpt="
];

export async function verifyXmlBackup(configXmlPath, configDir) {
  const absolute = path.isAbsolute(configXmlPath)
    ? configXmlPath
    : path.resolve(configDir, configXmlPath);

  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`XML backup not found: ${absolute}`);
    }
    throw new Error(`XML backup could not be read: ${absolute} (${err.message || err})`);
  }
  if (!stat.isFile()) {
    throw new Error(`XML backup is not a regular file: ${absolute}`);
  }
  if (stat.size === 0) {
    throw new Error(`XML backup is empty: ${absolute}`);
  }

  // Read a bounded prefix + hash the whole file. The prefix is enough to
  // sanity-check the format; the hash captures the full content so the
  // report is auditable.
  const fh = await fs.open(absolute, "r");
  let prefixText = "";
  try {
    const prefixLen = Math.min(stat.size, 4096);
    const buf = Buffer.alloc(prefixLen);
    await fh.read(buf, 0, prefixLen, 0);
    prefixText = buf.toString("utf8");
  } finally {
    await fh.close();
  }

  const looksLikeWxr = WXR_HINTS.filter((needle) => prefixText.includes(needle)).length >= 2;
  if (!looksLikeWxr) {
    throw new Error(
      `XML backup does not look like a WordPress WXR export: ${absolute}. ` +
        `Expected markers such as "<?xml", "wp:wxr_version" or "xmlns:wp=".`
    );
  }

  const hash = crypto.createHash("sha256");
  const contents = await fs.readFile(absolute);
  hash.update(contents);

  return {
    status: "verified",
    filename: absolute,
    sizeBytes: stat.size,
    sha256: hash.digest("hex"),
    verifiedAt: new Date().toISOString()
  };
}
