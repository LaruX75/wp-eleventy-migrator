// Reusable shortcode content samples for analyze-preflight tests. These
// live outside the JSON WXR file so the parser and analyze tests can
// import them directly without re-parsing XML.
//
// All samples are pure ASCII/UTF-8 strings; none contain real WordPress
// data. They exercise the shortcode-parser and criticality
// classification against representative WPBakery, Total, and plugin
// syntax.

// Nested paired shortcodes (WPBakery grid).
export const NESTED_PAIRED = `[vc_row]
[vc_column width="1/2"][vc_column_text]Hello[/vc_column_text][/vc_column]
[vc_column width="1/2"][vc_column_text]World[/vc_column_text][/vc_column]
[/vc_row]`;

// Self-closing shortcodes: explicit "/" and implicit (registered).
export const SELF_CLOSING = `[vc_empty_space height="16px"]
[rev_slider alias="promo" /]`;

// Escaped shortcodes: backslash and double-bracket forms.
export const ESCAPED = `Docs say: \\[vc_row\\] is a builder tag.
Sometimes written as [[vc_row]] to render literally.`;

// Malformed shortcodes: missing closing bracket / opener.
export const MALFORMED = `[vc_row attr="v"
[vc_column]Content that never closes`;

// Blocking + informational + manual-review mix inside one document.
// Used to exercise overallStatus resolution to "blocked".
export const BLOCKING_MIX = `[vc_row][vc_column]
[vc_empty_space height="16px"]
[rev_slider alias="promo"][/rev_slider]
[custom_unknown_shortcode]
[/vc_column][/vc_row]`;

// Informational-only content: only vc_empty_space + prose.
export const INFO_ONLY = `<p>Intro paragraph.</p>
[vc_empty_space height="24px"]
<p>Outro paragraph.</p>`;

// Manual-review-only content: unknown shortcode.
export const MANUAL_ONLY = `<p>Body.</p>
[unrecognised_widget key="v"]something[/unrecognised_widget]`;

// Regression fixtures for WPBakery leaf shortcodes that are written
// WITHOUT an explicit trailing `/` terminator. WordPress accepts these
// as syntactically valid single-tag shortcodes; the generic parser
// must therefore treat them as implicitly self-closing when the
// caller (analyze) registers them. Each fixture is the shortcode
// alone so classification can be asserted per-name without
// interference from surrounding structural tags.
export const VC_EMPTY_SPACE_NO_TERM = `[vc_empty_space height="16px"]`;
export const VC_CUSTOM_HEADING_NO_TERM = `[vc_custom_heading text="Section" font_container="tag:h3|text_align:center"]`;
export const VC_SINGLE_IMAGE_NO_TERM = `[vc_single_image image="123" alignment="center"]`;
export const VC_VIDEO_NO_TERM = `[vc_video align="center" link="https://example.com/x.mp4"]`;

// All four WPBakery leaf shortcodes together in one document. Used
// to prove that overallStatus reflects the manual-review roll-up
// and not "blocked" from an incorrect malformed-shortcode diagnosis.
export const WPBAKERY_LEAVES_ALL_NO_TERM = `<p>Intro.</p>
[vc_empty_space height="16px"]
[vc_custom_heading text="Heading" font_container="tag:h2"]
[vc_single_image image="42" alignment="center"]
[vc_video align="center" link="https://example.com/reel.mp4"]
<p>Outro.</p>`;
