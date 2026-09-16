// Inventory references without fetching or inventing attachment URLs. Relative
// references resolve against the source site, never against an attachment ID.
export function mediaReferences(text, baseUrl) {
  const urls = new Set();
  const add = (value) => {
    try {
      const url = new URL(value.replace(/&amp;/g, "&"), `${baseUrl}/`);
      if (["http:", "https:"].includes(url.protocol)) urls.add(url.href);
    } catch { /* An invalid reference cannot become a download candidate. */ }
  };
  for (const match of String(text).matchAll(/\b(?:src|poster|data-src|data-lazy-src|data-lazyload|data-original|data-lazy)=["']([^"']+)["']/gi)) add(match[1]);
  for (const match of String(text).matchAll(/\b(?:data-)?srcset=["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) add(part.trim().split(/\s+/)[0]);
  }
  for (const match of String(text).matchAll(/"(?:url|src|imgURL|backgroundImg)"\s*:\s*"([^"]+)"/gi)) add(match[1]);
  for (const match of String(text).matchAll(/url\(["']?([^"')]+)["']?\)/gi)) add(match[1]);
  return [...urls];
}
