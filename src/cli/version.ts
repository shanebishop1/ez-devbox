import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_LOOKUP_MAX_DEPTH = 6;
const PACKAGE_NAME = "ez-devbox";

interface PackageJsonShape {
  name?: string;
  version?: string;
}

export function readCliVersion(): string {
  let currentDirectory = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth <= PACKAGE_LOOKUP_MAX_DEPTH; depth += 1) {
    const packageJsonPath = join(currentDirectory, "package.json");
    if (existsSync(packageJsonPath)) {
      const raw = readFileSync(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw) as PackageJsonShape;
      if (parsed.name === PACKAGE_NAME && typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    }

    const parent = dirname(currentDirectory);
    if (parent === currentDirectory) {
      break;
    }
    currentDirectory = parent;
  }

  throw new Error("Unable to resolve CLI version from package.json.");
}
