import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface PackageJsonShape {
  version: string;
}

interface NpmPackRecord {
  filename: string;
}

const REQUIRED_BINS = ["ez-devbox", "ezdb"] as const;
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJsonShape;

function runNpm(args: string[]): string {
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined) {
    throw new Error("npm_execpath is required; run this check through 'npm run pack:check'.");
  }

  return execFileSync(process.execPath, [npmCli, ...args], { encoding: "utf8" });
}

function runInstalledBin(installRoot: string, bin: string, argument: "--help" | "--version"): string {
  if (process.platform === "win32") {
    return runNpm(["exec", "--offline", "--prefix", installRoot, "--", bin, argument]);
  }

  const executable = join(installRoot, "node_modules", ".bin", bin);
  const result = spawnSync(executable, [argument], { encoding: "utf8" });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${bin} ${argument} exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

function parsePackOutput(output: string): NpmPackRecord {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0]?.filename !== "string") {
    throw new Error("npm pack --json output is missing the package filename.");
  }
  return parsed[0] as NpmPackRecord;
}

function assertLibraryImportIsPassive(installRoot: string): void {
  const entrypointUrl = pathToFileURL(join(installRoot, "node_modules", "ez-devbox", "dist", "src", "cli", "index.js"));
  const script = `await import(${JSON.stringify(entrypointUrl.href)}); process.stdout.write("import-only");`;
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8" });
  if (output !== "import-only") {
    throw new Error(`Importing the installed CLI produced unexpected output: ${JSON.stringify(output)}`);
  }
}

function main(): void {
  const workRoot = mkdtempSync(join(tmpdir(), "ez-devbox-package-smoke-"));
  const packageRoot = join(workRoot, "package");

  try {
    const packRecord = parsePackOutput(runNpm(["pack", "--json", "--pack-destination", workRoot]));
    const tarballPath = join(workRoot, packRecord.filename);
    runNpm([
      "install",
      "--prefix",
      packageRoot,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--offline",
      tarballPath,
    ]);

    for (const bin of REQUIRED_BINS) {
      const versionOutput = runInstalledBin(packageRoot, bin, "--version").trim();
      if (versionOutput !== packageJson.version) {
        throw new Error(`${bin} --version returned '${versionOutput}', expected '${packageJson.version}'.`);
      }

      const helpOutput = runInstalledBin(packageRoot, bin, "--help");
      if (!helpOutput.includes("ez-devbox CLI")) {
        throw new Error(`${bin} --help did not return the CLI help text.`);
      }
    }

    assertLibraryImportIsPassive(packageRoot);

    console.log(
      `Installed-package smoke passed for ${REQUIRED_BINS.join(" and ")} (--version and --help); library import remained passive.`,
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

main();
