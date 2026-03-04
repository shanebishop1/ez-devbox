import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REQUIRED_PATHS = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/src/cli/index.js",
  "dist/src/cli/index.d.ts",
  "scripts/ws-ssh-proxy.mjs",
] as const;

interface NpmPackDryRunFileRecord {
  path: string;
}

interface NpmPackDryRunRecord {
  filename: string;
  files: NpmPackDryRunFileRecord[];
}

interface PackageJsonShape {
  bin?: Record<string, string>;
}

function parsePackDryRunOutput(output: string): NpmPackDryRunRecord {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack --dry-run --json returned no package records.");
  }

  const first = parsed[0];
  if (
    typeof first !== "object" ||
    first === null ||
    !("files" in first) ||
    !Array.isArray(first.files) ||
    !("filename" in first) ||
    typeof first.filename !== "string"
  ) {
    throw new Error("npm pack --dry-run --json output is missing expected pack record fields.");
  }

  return first as NpmPackDryRunRecord;
}

function assertRequiredPaths(filesSet: ReadonlySet<string>): void {
  const missing = REQUIRED_PATHS.filter((path) => !filesSet.has(path));
  if (missing.length > 0) {
    throw new Error(`Pack dry-run is missing required files: ${missing.join(", ")}`);
  }
}

function assertBinTarget(filesSet: ReadonlySet<string>): void {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJsonShape;
  const binEntries = Object.values(packageJson.bin ?? {});
  for (const relativePath of binEntries) {
    if (!filesSet.has(relativePath)) {
      throw new Error(`Pack dry-run is missing bin target '${relativePath}'.`);
    }
  }
}

function main(): void {
  const output = execSync("npm pack --dry-run --json", { encoding: "utf8" });
  const packRecord = parsePackDryRunOutput(output);
  const filePaths = new Set(packRecord.files.map((file) => file.path));

  assertRequiredPaths(filePaths);
  assertBinTarget(filePaths);

  console.log(
    `Pack verification passed: ${packRecord.filename} includes ${packRecord.files.length} files and required runtime artifacts.`,
  );
}

main();
