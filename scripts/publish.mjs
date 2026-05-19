#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// SDK before CLI: CLI depends on SDK.
const pkgs = ["packages/sdk", "packages/cli"];

const extraArgs = process.argv.slice(2).join(" ");

// Ensure the lockfile reflects current workspace versions so `bun pm pack`
// rewrites `workspace:*` to the freshly-bumped SDK version, not a cached one.
console.log("syncing lockfile with workspace versions...");
execSync("bun install", { stdio: "inherit" });

// We pack with bun (resolves workspace:*) and publish with npm. bun publish
// has a quirk where it returns 404 against the npm registry for new versions
// even with valid auth in .npmrc; npm publish reads .npmrc reliably.
for (const dir of pkgs) {
  const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
  if (pkg.private) continue;

  console.log(`packing ${pkg.name}@${pkg.version} from ${dir}`);
  const stage = mkdtempSync(resolve(tmpdir(), "publish-"));
  execSync(`bun pm pack --destination ${stage}`, { cwd: dir, stdio: "inherit" });
  const tgz = readdirSync(stage).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`pack produced no tarball in ${stage}`);
  const tarballPath = resolve(stage, tgz);

  // Guard: refuse to publish if workspace: protocol leaked into the tarball.
  execSync(`tar xzf ${tarballPath} -C ${stage}`);
  const packed = readFileSync(resolve(stage, "package/package.json"), "utf8");
  if (/workspace:/.test(packed)) {
    throw new Error(
      `${pkg.name}: packed package.json still contains \`workspace:\` protocol. Aborting.`,
    );
  }

  console.log(`publishing ${tarballPath}`);
  execSync(`npm publish ${tarballPath} --access public ${extraArgs}`.trim(), {
    stdio: "inherit",
  });
}
