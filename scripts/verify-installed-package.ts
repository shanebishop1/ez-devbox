import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PackageJsonShape {
  version: string;
}

interface NpmPackRecord {
  filename: string;
}

const REQUIRED_BINS = ["ez-devbox", "ezdb"] as const;
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as PackageJsonShape;

function runNpm(args: string[], cacheRoot: string): string {
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined) {
    throw new Error("npm_execpath is required; run this check through 'npm run pack:check'.");
  }

  return execFileSync(process.execPath, [npmCli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: cacheRoot,
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
    },
  });
}

function runInstalledBin(
  installRoot: string,
  cacheRoot: string,
  bin: string,
  argument: "--help" | "--version",
): string {
  if (process.platform === "win32") {
    return runNpm(["exec", "--prefix", installRoot, "--", bin, argument], cacheRoot);
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

function assertNpmBinLink(installRoot: string, bin: string): void {
  const executableName = process.platform === "win32" ? `${bin}.cmd` : bin;
  const executable = join(installRoot, "node_modules", ".bin", executableName);
  const stats = lstatSync(executable);
  if (process.platform !== "win32" && !stats.isSymbolicLink()) {
    throw new Error(`npm did not create '${executable}' as a symbolic link.`);
  }
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
  const installRoot = join(workRoot, "consumer");
  const cacheRoot = join(workRoot, "empty-npm-cache");

  try {
    const packRecord = parsePackOutput(
      runNpm(["pack", PROJECT_ROOT, "--json", "--pack-destination", workRoot], cacheRoot),
    );
    const tarballPath = join(workRoot, packRecord.filename);
    if (!lstatSync(tarballPath).isFile()) {
      throw new Error(`npm pack did not create '${tarballPath}'.`);
    }

    runNpm(
      [
        "install",
        "--prefix",
        installRoot,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--no-save",
        "--no-install-links",
        "--bin-links=true",
        PROJECT_ROOT,
      ],
      cacheRoot,
    );

    for (const bin of REQUIRED_BINS) {
      assertNpmBinLink(installRoot, bin);

      const versionOutput = runInstalledBin(installRoot, cacheRoot, bin, "--version").trim();
      if (versionOutput !== packageJson.version) {
        throw new Error(`${bin} --version returned '${versionOutput}', expected '${packageJson.version}'.`);
      }

      const helpOutput = runInstalledBin(installRoot, cacheRoot, bin, "--help");
      if (!helpOutput.includes("ez-devbox CLI")) {
        throw new Error(`${bin} --help did not return the CLI help text.`);
      }
    }

    assertLibraryImportIsPassive(installRoot);

    console.log(
      `Offline npm bin-link smoke passed for ${REQUIRED_BINS.join(" and ")} (--version and --help); packed artifact exists and library import remained passive.`,
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

main();
