import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { docsContentRoute, docsImageRoute, docsRoute } from "./shared";

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [],
});

// `loader()` widens `page.data` to the base `PageData` (no `body`/`toc`/`getText`):
// fumadocs-core's `Source` generic exposes the page-data type only through indexed
// access, so TypeScript can't infer it back out. The collection entry carries the
// real shape, so recover it here and cast `page.data` at the use sites.
export type DocPageData = (typeof docs.docs)[number];

export function getPageImage(page: (typeof source)["$inferPage"]) {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: `${docsImageRoute}/${segments.join("/")}`,
  };
}

export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]) {
  const segments = [...page.slugs, "content.md"];

  return {
    segments,
    url: `${docsContentRoute}/${segments.join("/")}`,
  };
}

export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const processed = await (page.data as DocPageData).getText("processed");

  return `# ${page.data.title} (${page.url})

${processed}`;
}
