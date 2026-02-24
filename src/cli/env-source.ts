import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseDotEnv } from "dotenv";

export async function loadCliEnvSource(envPath: string = resolve(process.cwd(), ".env")): Promise<Record<string, string | undefined>> {
  let parsedFileEnv: Record<string, string | undefined> = {};

  try {
    parsedFileEnv = parseDotEnv(await readFile(envPath, "utf8"));
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    ...parsedFileEnv,
    ...process.env
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
