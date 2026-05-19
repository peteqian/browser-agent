#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SDK before CLI: CLI depends on SDK.
const pkgs = ["packages/sdk", "packages/cli"];

const extraArgs = process.argv.slice(2);

// Ensure lockfile reflects current workspace versions so `bun publish`
// rewrites `workspace:*` to the freshly-bumped version, not a cached one.
console.log("syncing lockfile with workspace versions...");
execSync("bun install", { stdio: "inherit" });

for (const dir of pkgs) {
  const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
  if (pkg.private) continue;
  console.log(`publishing ${pkg.name}@${pkg.version} from ${dir}`);
  execSync(`bun publish --access public ${extraArgs.join(" ")}`.trim(), {
    cwd: dir,
    stdio: "inherit",
  });
}
