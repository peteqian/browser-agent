import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/cli": "bin/cli.ts",
    "bin/mcp": "bin/mcp.ts",
  },
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  sourcemap: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
    __PACKAGE_NAME__: JSON.stringify(pkg.name),
  },
});
