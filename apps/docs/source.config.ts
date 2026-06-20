import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";

// Content lives in the repo-root `docs/` directory (single source of truth).
// Only `.mdx` is ingested for the site; the AI manual under `docs/ai/` is `.md`
// and explicitly excluded so it stays separate from the published site.
export const docs = defineDocs({
  dir: "../../docs",
  docs: {
    files: ["**/*.mdx", "!ai/**"],
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    files: ["**/*.json", "!ai/**"],
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    // MDX options
  },
});
