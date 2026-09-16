export const ORIGIN = "https://wordpress.example";
export const FULL = `${ORIGIN}/wp-content/uploads/2021/event.png`;
export const SMALL = `${ORIGIN}/wp-content/uploads/2021/event-300x200.png`;
export const RECORD = {
  id: 123, mime_type: "image/png", source_url: FULL,
  alt_text: "Record alt", caption: { rendered: "Record caption" },
  media_details: { sizes: {
    medium: { source_url: SMALL, mime_type: "image/png", width: 300, height: 200 },
    // Filename alone is not authoritative URL evidence.
    missingUrl: { file: "event-99x99.png", width: 99, height: 99 }
  } }
};
export const HTML = `<figure class="wp-caption" id="attachment_123"><a href="${FULL}" title="Open original"><picture><source media="(min-width: 600px)" srcset="${SMALL} 1x, ${FULL} 2x"><img class='wp-image-123' src='/wp-content/uploads/2021/event-300x200.png' srcset='${SMALL} 300w, ${FULL} 1200w' sizes='(max-width: 600px) 100vw, 600px' width="600" height="400" alt="Event &amp; friends" loading="lazy"></picture></a><figcaption>A <em>community</em> day &amp; friends.</figcaption></figure>`;
