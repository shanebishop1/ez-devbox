import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

type ReleaseBump = "major" | "minor" | "patch" | "premajor" | "preminor" | "prepatch" | "prerelease";

const VALID_BUMPS: ReadonlySet<ReleaseBump> = new Set([
  "major",
  "minor",
  "patch",
  "premajor",
  "preminor",
  "prepatch",
  "prerelease",
]);

interface PackageJsonShape {
  version: string;
}

interface CommandOptions {
  stdio?: "inherit" | "pipe";
}

function run(command: string, args: string[], options: CommandOptions = {}): string {
  const commandLine = [command, ...args].join(" ");
  console.log(`\n$ ${commandLine}`);

  const result = spawnSync(command, args, {
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Failed to run '${commandLine}': ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${commandLine}`);
  }

  return (result.stdout ?? "").trim();
}

function ensureCommandExists(command: string): void {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    throw new Error(`Required command is missing or not executable: ${command}`);
  }
}

function hasUntrackedFiles(): boolean {
  const output = run("git", ["ls-files", "--others", "--exclude-standard"], { stdio: "pipe" });
  return output.length > 0;
}

function hasUnstagedChanges(): boolean {
  const result = spawnSync("git", ["diff", "--quiet"], { stdio: "ignore" });
  return result.status !== 0;
}

function hasStagedChanges(): boolean {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], { stdio: "ignore" });
  return result.status !== 0;
}

function ensureCleanWorkingTree(): void {
  if (hasUntrackedFiles() || hasUnstagedChanges() || hasStagedChanges()) {
    throw new Error("Working tree is not clean. Commit or remove local changes before running the release script.");
  }
}

function getCurrentBranch(): string {
  return run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { stdio: "pipe" });
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJsonShape;
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json is missing a valid version string.");
  }

  return packageJson.version;
}

function assertValidArgs(bump: string | undefined): ReleaseBump {
  if (bump === undefined) {
    throw new Error(
      "Missing release bump argument. Use: major | minor | patch | premajor | preminor | prepatch | prerelease",
    );
  }

  if (!VALID_BUMPS.has(bump as ReleaseBump)) {
    throw new Error(`Invalid release bump '${bump}'. Use one of: ${Array.from(VALID_BUMPS).join(", ")}`);
  }

  return bump as ReleaseBump;
}

function ensureGhAuth(): void {
  run("gh", ["auth", "status"]);
}

function main(): void {
  let createdTag: string | null = null;

  try {
    const bump = assertValidArgs(process.argv[2]);

    ensureCommandExists("git");
    ensureCommandExists("npm");
    ensureCommandExists("gh");

    ensureCleanWorkingTree();

    const branch = getCurrentBranch();
    if (branch !== "main") {
      throw new Error(`Release must run from 'main'. Current branch: '${branch}'.`);
    }

    ensureGhAuth();

    run("git", ["fetch", "origin"]);
    run("git", ["pull", "--ff-only", "origin", "main"]);

    run("npm", ["ci"]);
    run("npm", ["run", "validate"]);
    run("npm", ["run", "pack:check"]);

    run("npm", ["version", bump]);

    const version = readPackageVersion();
    createdTag = `v${version}`;

    run("git", ["push", "origin", "main", "--follow-tags"]);
    run("gh", ["release", "create", createdTag, "--target", "main", "--generate-notes", "--title", createdTag]);

    console.log(`\nRelease complete: ${createdTag}`);
    console.log(`Watch workflow: gh run list --workflow "Release" --limit 1`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nRelease failed: ${message}`);

    if (createdTag !== null) {
      console.error(`A local release commit/tag may exist (${createdTag}). Verify state before retrying.`);
    }

    process.exitCode = 1;
  }
}

main();
