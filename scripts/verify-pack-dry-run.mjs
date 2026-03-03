#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const REQUIRED_PATHS = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/src/cli/index.js",
  "dist/src/cli/index.d.ts",
  "scripts/ws-ssh-proxy.mjs"
];

function parsePackDryRunOutput(output) {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack --dry-run --json returned no package records.");
  }

  const first = parsed[0];
  if (!first || !Array.isArray(first.files)) {
    throw new Error("npm pack --dry-run --json output is missing the files list.");
  }

  return first;
}

function assertRequiredPaths(filesSet) {
  const missing = REQUIRED_PATHS.filter((path) => !filesSet.has(path));
  if (missing.length > 0) {
    throw new Error(`Pack dry-run is missing required files: ${missing.join(", ")}`);
  }
}

function assertBinTarget(filesSet) {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const binEntries = Object.values(packageJson.bin ?? {});
  for (const relativePath of binEntries) {
    if (!filesSet.has(relativePath)) {
      throw new Error(`Pack dry-run is missing bin target '${relativePath}'.`);
    }
  }
}

function main() {
  const output = execSync("npm pack --dry-run --json", { encoding: "utf8" });
  const packRecord = parsePackDryRunOutput(output);
  const filePaths = new Set(packRecord.files.map((file) => file.path));

  assertRequiredPaths(filePaths);
  assertBinTarget(filePaths);

  console.log(
    `Pack verification passed: ${packRecord.filename} includes ${packRecord.files.length} files and required runtime artifacts.`
  );
}

main();
