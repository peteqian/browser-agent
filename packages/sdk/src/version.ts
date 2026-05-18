/**
 * Build-time-injected package identity.
 *
 * In published builds, tsup's `define` (see `tsup.config.ts`) replaces
 * `__PACKAGE_VERSION__` and `__PACKAGE_NAME__` with string literals
 * sourced from this package's own `package.json`. esbuild constant-folds
 * the `typeof` ternary, so the `pkg.*` branch is dead code in the bundle.
 *
 * In dev + test (no bundler), the `typeof` guard falls through to a
 * direct `package.json` import. Single source of truth either way —
 * the file never drifts if the package is renamed.
 */
import pkg from "../package.json" with { type: "json" };

declare const __PACKAGE_VERSION__: string;
declare const __PACKAGE_NAME__: string;

export const VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : pkg.version;

export const PACKAGE_NAME: string =
  typeof __PACKAGE_NAME__ !== "undefined" ? __PACKAGE_NAME__ : pkg.name;
