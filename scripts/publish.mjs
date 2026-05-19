#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// SDK before CLI: CLI depends on SDK.
const pkgs = ["packages/sdk", "packages/cli"];

const extraArgs = process.argv.slice(2);

// Ensure lockfile reflects current workspace versions so `bun publish`
// rewrites `workspace:*` to the freshly-bumped version, not a cached one.
console.log("syncing lockfile with workspace versions...");
execSync("bun install", { stdio: "inherit" });

function assertNoWorkspaceProtocol(dir, pkg) {
  const stage = mkdtempSync(resolve(tmpdir(), "publish-verify-"));
  execSync(`bun pm pack --destination ${stage}`, { cwd: dir, stdio: "inherit" });
  const tgz = readdirSync(stage).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`pack produced no tarball in ${stage}`);
  execSync(`tar xzf ${resolve(stage, tgz)} -C ${stage}`);
  const packed = readFileSync(resolve(stage, "package/package.json"), "utf8");
  if (/workspace:/.test(packed)) {
    throw new Error(
      `${pkg.name}: published package.json still contains \`workspace:\` protocol. Aborting publish.\n${packed}`,
    );
  }
}

for (const dir of pkgs) {
  const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
  if (pkg.private) continue;
  console.log(`verifying pack for ${pkg.name}@${pkg.version}...`);
  assertNoWorkspaceProtocol(dir, pkg);
  console.log(`publishing ${pkg.name}@${pkg.version} from ${dir}`);
  execSync(`bun publish --access public ${extraArgs.join(" ")}`.trim(), {
    cwd: dir,
    stdio: "inherit",
  });
}
