import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  entry: ["src/index.ts", "src/internal.ts"],
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
