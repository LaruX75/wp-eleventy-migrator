import { MEDIA_RECORD, IMAGE_BYTES } from "../wpbakery-content/media.mjs";
export { IMAGE_BYTES };
export const baseUrl = "https://wordpress.example";
export const attachment = { ...MEDIA_RECORD, content: { raw: "", rendered: "" } };
export const firstPost = {
  id: 1, type: "post", status: "publish", slug: "snapshot", date: "2021-09-07T12:00:00",
  link: `${baseUrl}/snapshot/`, title: { raw: "Snapshot", rendered: "Snapshot" },
  content: { raw: '[vc_row][vc_column][vc_single_image image="123"][/vc_column][/vc_row]',
    rendered: '[vc_row][vc_column][vc_single_image image="123"][/vc_column][/vc_row]' },
  categories: [5], tags: [6], author: 7, featured_media: 123,
  excerpt: { raw: "Raw excerpt", rendered: "<p>Excerpt</p>" },
  meta: { plugin_specific: { nested: [1, "preserve whole"] } }, translations: { fi: 1, en: 2 },
  _embedded: { author: [{ id: 7, name: "Test author" }], "wp:featuredmedia": [attachment] }
};
export const secondPost = { ...firstPost, id: 2, slug: "second", featured_media: 0,
  content: { raw: "<p>Raw second</p>", rendered: `<p>Second</p><img src="${attachment.source_url}">` } };
export const customPost = { ...firstPost, id: 3, type: "book", slug: "book", content: { rendered: "<p>Book</p>" } };
export const collections = {
  "/wp/v2/posts": [[firstPost], [secondPost]], "/wp/v2/pages": [[]],
  "/wp/v2/media": [[attachment]], "/wp/v2/categories": [[{ id: 5, name: "Events" }]],
  "/wp/v2/tags": [[{ id: 6, name: "News" }]], "/wp/v2/users": [[{ id: 7, name: "Test author" }]],
  "/library/v1/books": [[customPost]], "/wp/v2/genres": [[{ id: 8, name: "Novel", taxonomy: "genre" }]]
};
export const types = {
  post: { rest_base: "posts", rest_namespace: "wp/v2" }, page: { rest_base: "pages", rest_namespace: "wp/v2" },
  attachment: { rest_base: "media", rest_namespace: "wp/v2" }, book: { rest_base: "books", rest_namespace: "library/v1" }
};
export const taxonomies = {
  category: { rest_base: "categories" }, post_tag: { rest_base: "tags" }, genre: { rest_base: "genres", types: ["book"] }
};
export const discovery = { authentication: { "application-passwords": { endpoints: { authorization: `${baseUrl}/wp-admin/authorize-application.php` } } }, namespaces: ["wp/v2", "library/v1"], routes: Object.fromEntries(Object.keys(collections).map((route) => [route, {
  endpoints: [{ methods: ["GET"], args: { status: { items: { enum: route.endsWith("/media") ? ["inherit", "private", "trash"] : ["publish", "draft", "private", "pending", "future", "trash", "auto-draft", "any"] } } } }]
}])) };
