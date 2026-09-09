import type { JsonRecord } from "./load.types.js";
import type { ResolvedCustomAgentConfig } from "./schema.js";

const CUSTOM_FOLLOW_UPS = ["tmux"] as const;

export function resolveCustomAgent(rawAgent: JsonRecord): ResolvedCustomAgentConfig {
  const filesRaw = getOptionalArray(rawAgent, "files", "agent.files");
  const initialPromptCommand = getOptionalStringArray(
    rawAgent,
    "initial_prompt_command",
    "agent.initial_prompt_command",
  );
  const followUp = getOptionalEnum(rawAgent, "follow_up", "agent.follow_up", CUSTOM_FOLLOW_UPS);
  const checkCommand = getOptionalString(rawAgent, "check_command", "agent.check_command");
  const installCommand = getOptionalString(rawAgent, "install_command", "agent.install_command");

  return {
    command: getOptionalStringArray(rawAgent, "command", "agent.command") ?? [],
    ...(checkCommand !== undefined ? { check_command: checkCommand } : {}),
    ...(installCommand !== undefined ? { install_command: installCommand } : {}),
    ...(initialPromptCommand !== undefined ? { initial_prompt_command: initialPromptCommand } : {}),
    ...(followUp !== undefined ? { follow_up: followUp } : {}),
    files: resolveAgentFiles(filesRaw),
  };
}

function resolveAgentFiles(rawFiles: unknown[] | undefined): ResolvedCustomAgentConfig["files"] {
  if (rawFiles === undefined) {
    return [];
  }

  return rawFiles.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid agent.files[${index}]: expected a TOML table.`);
    }
    return {
      source: getRequiredString(entry, "source", `agent.files[${index}].source`),
      destination: getRequiredString(entry, "destination", `agent.files[${index}].destination`),
      optional: getOptionalBoolean(entry, "optional", `agent.files[${index}].optional`) ?? false,
    };
  });
}

function getOptionalArray(parent: JsonRecord, key: string, path: string): unknown[] | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${path}: expected an array.`);
  }
  return value;
}

function getOptionalStringArray(parent: JsonRecord, key: string, path: string): string[] | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Invalid ${path}: expected an array of strings.`);
  }
  return [...value];
}

function getOptionalString(parent: JsonRecord, key: string, path: string): string | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid ${path}: expected a string.`);
  }
  return value;
}

function getRequiredString(parent: JsonRecord, key: string, path: string): string {
  const value = getOptionalString(parent, key, path);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Invalid ${path}: required non-empty string is missing.`);
  }
  return value;
}

function getOptionalBoolean(parent: JsonRecord, key: string, path: string): boolean | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${path}: expected a boolean.`);
  }
  return value;
}

function getOptionalEnum<T extends readonly string[]>(
  parent: JsonRecord,
  key: string,
  path: string,
  values: T,
): T[number] | undefined {
  const value = getOptionalString(parent, key, path);
  if (value === undefined) {
    return undefined;
  }
  if (!values.includes(value)) {
    throw new Error(`Invalid ${path}: expected one of ${values.join("|")}.`);
  }
  return value as T[number];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
