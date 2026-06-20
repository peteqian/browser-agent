export const appName = "browser-agent";
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";

export const gitConfig = {
  user: "peteqian",
  repo: "browser-agent",
  branch: "main",
};

// GitHub Pages serves the project site under /<repo>/ in production; root in dev.
// Mirrors basePath in next.config.mjs so we can build correct links to static
// assets (like /llms.txt) that Next's <Link> does not auto-prefix.
export const basePath = process.env.NODE_ENV === "production" ? `/${gitConfig.repo}` : "";
