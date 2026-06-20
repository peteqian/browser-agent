import { defineConfig, defineDocs } from "fumadocs-mdx/config";

// Content lives in the repo-root `docs/` directory (single source of truth).
// Only `.mdx` is ingested for the site; the AI manual under `docs/ai/` is `.md`
// and explicitly excluded so it stays separate from the published site.
// `schema` is left to defineDocs' defaults (pageSchema/metaSchema) — passing
// them explicitly breaks page-data type inference through `loader`.
export const docs = defineDocs({
  dir: "../../docs",
  docs: {
    files: ["**/*.mdx", "!ai/**"],
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    files: ["**/*.json", "!ai/**"],
  },
});

export default defineConfig({
  mdxOptions: {
    // MDX options
  },
});
