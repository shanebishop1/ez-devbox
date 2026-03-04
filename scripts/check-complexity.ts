import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = "src";
const MAX_FILE_LINES = 280;
const MAX_COMPLEXITY_SCORE = 55;
const BRANCH_TOKEN_REGEX = /\b(if|for|while|case|catch)\b|\?\s|&&|\|\|/g;
const LINE_LIMIT_ALLOWLIST: Readonly<Record<string, number>> = {
  // TODO(cleanup): Split setup runner to remove this exception.
  "src/setup/runner.ts": 320,
};
const COMPLEXITY_LIMIT_ALLOWLIST: Readonly<Record<string, number>> = {
  // TODO(cleanup): Continue parser decomposition to remove this exception.
  "src/config/load.raw-parse.ts": 70,
};

interface FileCheckResult {
  path: string;
  lineCount: number;
  complexityScore: number;
  violations: string[];
}

function collectTypeScriptFiles(rootPath: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function toComplexityScore(source: string): number {
  const matches = source.match(BRANCH_TOKEN_REGEX);
  return (matches?.length ?? 0) + 1;
}

function checkFile(path: string): FileCheckResult {
  const source = readFileSync(path, "utf8");
  const lineCount = source.split(/\r?\n/).length;
  const complexityScore = toComplexityScore(source);
  const violations: string[] = [];
  const maxLines = LINE_LIMIT_ALLOWLIST[path] ?? MAX_FILE_LINES;
  const maxComplexity = COMPLEXITY_LIMIT_ALLOWLIST[path] ?? MAX_COMPLEXITY_SCORE;

  if (lineCount > maxLines) {
    violations.push(`lines=${lineCount} exceeds max ${maxLines}`);
  }

  if (complexityScore > maxComplexity) {
    violations.push(`complexity=${complexityScore} exceeds max ${maxComplexity}`);
  }

  return {
    path,
    lineCount,
    complexityScore,
    violations,
  };
}

function main(): void {
  const files = collectTypeScriptFiles(SRC_ROOT);
  const results = files.map(checkFile);
  const violating = results.filter((result) => result.violations.length > 0);

  if (violating.length > 0) {
    console.error("Complexity guardrail violations:");
    for (const result of violating) {
      console.error(`- ${result.path}: ${result.violations.join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Complexity guardrails passed for ${results.length} files (default max lines=${MAX_FILE_LINES}, default max complexity=${MAX_COMPLEXITY_SCORE}, line exceptions=${Object.keys(LINE_LIMIT_ALLOWLIST).length}, complexity exceptions=${Object.keys(COMPLEXITY_LIMIT_ALLOWLIST).length}).`,
  );
}

main();
