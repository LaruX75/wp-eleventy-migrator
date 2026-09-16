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
