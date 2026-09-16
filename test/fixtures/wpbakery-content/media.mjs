// Synthetic WordPress REST attachment record and one-pixel PNG. No live source.
export const MEDIA_RECORD = {
  id: 123,
  type: "attachment",
  media_type: "image",
  mime_type: "image/png",
  source_url: "https://wordpress.example/wp-content/uploads/2021/09/event.png",
  alt_text: 'An event & "friends"',
  caption: { rendered: "<p>Community <strong>day</strong> &amp; fun.</p><!-- private -->" }
};

export const IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=",
  "base64"
);

export const MEDIA_BODY = `[vc_row][vc_column]
[vc_custom_heading text="Community day"]
[vc_column_text]<p>Everyone is welcome.</p>[/vc_column_text]
[vc_empty_space height="12px"]
[vc_video link="https://youtu.be/dQw4w9WgXcQ"]
[vc_single_image image="123"]
[/vc_column][/vc_row]`;
