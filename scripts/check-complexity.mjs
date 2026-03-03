import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = "src";
const MAX_FILE_LINES = 650;
const MAX_COMPLEXITY_SCORE = 160;
const BRANCH_TOKEN_REGEX = /\b(if|for|while|case|catch)\b|\?\s|&&|\|\|/g;

function collectTypeScriptFiles(rootPath) {
  const files = [];
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

function toComplexityScore(source) {
  const matches = source.match(BRANCH_TOKEN_REGEX);
  return (matches?.length ?? 0) + 1;
}

function checkFile(path) {
  const source = readFileSync(path, "utf8");
  const lineCount = source.split(/\r?\n/).length;
  const complexityScore = toComplexityScore(source);
  const violations = [];

  if (lineCount > MAX_FILE_LINES) {
    violations.push(`lines=${lineCount} exceeds max ${MAX_FILE_LINES}`);
  }

  if (complexityScore > MAX_COMPLEXITY_SCORE) {
    violations.push(`complexity=${complexityScore} exceeds max ${MAX_COMPLEXITY_SCORE}`);
  }

  return {
    path,
    lineCount,
    complexityScore,
    violations
  };
}

function main() {
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
    `Complexity guardrails passed for ${results.length} files (max lines=${MAX_FILE_LINES}, max complexity=${MAX_COMPLEXITY_SCORE}).`
  );
}

main();
