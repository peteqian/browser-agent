/**
 * Build-time-injected package identity. See `packages/sdk/src/version.ts`
 * for the rationale.
 */
import pkg from "../package.json" with { type: "json" };

declare const __PACKAGE_VERSION__: string;
declare const __PACKAGE_NAME__: string;

export const VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : pkg.version;

export const PACKAGE_NAME: string =
  typeof __PACKAGE_NAME__ !== "undefined" ? __PACKAGE_NAME__ : pkg.name;
