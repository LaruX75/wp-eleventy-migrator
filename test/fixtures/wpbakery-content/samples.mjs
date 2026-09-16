// Offline fixtures derived from the shortcode families the jaali.eu
// analyze preflight observed on real WordPress posts. Every sample
// is representative of a shape found in the corpus (nested
// row/column/text, WPBakery leaves without a trailing `/`, YouTube
// video embed shortcode, attachment-ID single image). None of these
// strings contain site-identifying content — they only reproduce
// the shortcode idioms that the transformer must survive.

// A post shaped like a "Jäälin Juhlapäivä 2021"-style article:
// nested WPBakery grid, a heading, textual content, an embedded
// YouTube video, and an attachment-referenced image. Written in the
// exact idiomatic form the analyze preflight found in real content
// (leaves without `/`, `[vc_column_text]` inline with plain HTML,
// `font_container` pipe-separated attributes).
export const JUHLAPAIVA_SHAPED = `[vc_row][vc_column]
[vc_custom_heading text="Kutsu tapahtumaan" font_container="tag:h2|text_align:center|color:%23416972" use_theme_fonts="yes"]
[vc_empty_space height="16px"]
[vc_column_text]
<p>Tervetuloa juhlaan lauantaina.</p>
<p><strong>Ohjelma alkaa</strong> kello 12.00.</p>
[/vc_column_text]
[vc_empty_space height="24px"]
[vc_video link="https://youtu.be/dQw4w9WgXcQ" align="center"]
[vc_single_image image="2658" alignment="center"]
[/vc_column][/vc_row]`;

// Only structural wrappers with plain HTML inside. Common in
// classic-editor posts that were later wrapped when moving to a
// WPBakery page. The transformer must strip the wrappers entirely
// and leave the inner HTML untouched.
export const WRAPPERS_ONLY = `[vc_row][vc_column][vc_column_text]
<p>Body paragraph one.</p>
<p>Body paragraph two.</p>
[/vc_column_text][/vc_column][/vc_row]`;

// A vc_video whose target is not YouTube — must fall back to a
// clickable link and never leave `[vc_video]` visible.
export const VIDEO_NON_YOUTUBE = `[vc_row][vc_column]
[vc_video link="https://vimeo.com/12345678"]
[/vc_column][/vc_row]`;

// A vc_custom_heading with pipe-separated font_container and HTML
// entities in the text.
export const HEADING_WITH_ENTITIES = `[vc_custom_heading text="Kysymyksi&auml; &amp; vastauksia" font_container="tag:h3|text_align:left"]`;

// Nested wrappers with an unknown vcex_* plugin shortcode in the
// middle. The transformer must strip the wrappers, preserve the
// unknown unit as an HTML comment, and never emit raw `[vcex_*]`.
// vcex_button is paired (`[…]label[/…]`) — the shape observed in
// real Total-theme content.
export const UNKNOWN_VCEX = `[vc_row][vc_column]
[vcex_button style="outline"]Read more[/vcex_button]
[vc_column_text]<p>Body after button.</p>[/vc_column_text]
[/vc_column][/vc_row]`;

// vc_single_image with attachment ID only — must NOT invent a URL.
export const SINGLE_IMAGE_ID_ONLY = `[vc_single_image image="42" alignment="center"]`;
