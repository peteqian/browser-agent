import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// GitHub Pages project site is served from https://<user>.github.io/browser-agent/
// so the app needs a basePath in production. Locally (dev/preview) it stays at root.
const isProd = process.env.NODE_ENV === "production";
const repo = "browser-agent";

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: isProd ? `/${repo}` : "",
};

export default withMDX(config);
