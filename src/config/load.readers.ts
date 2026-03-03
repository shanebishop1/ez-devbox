import { readFile } from "node:fs/promises";
import { parse as parseDotEnv } from "dotenv";
import { parse as parseToml } from "smol-toml";
import type { JsonRecord } from "./load.types.js";

export async function readTomlConfig(configPath: string): Promise<JsonRecord> {
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(`Cannot load launcher config at '${configPath}': file does not exist.`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = parseToml(source);
  } catch (error) {
    throw new Error(`Cannot parse launcher config at '${configPath}': ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid launcher config root: expected a TOML table.");
  }

  return parsed;
}

export async function readEnvFile(envPath: string): Promise<Record<string, string>> {
  try {
    const source = await readFile(envPath, "utf8");
    return parseDotEnv(source);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return {};
    }
    throw new Error(`Cannot read env file at '${envPath}': ${(error as Error).message}`);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
