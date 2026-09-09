import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { StartupMode } from "../types/index.js";
import { assertArgvByteLimit, validateCommandArgv, validateInitialPromptCommand } from "./custom-agent.prompt.js";
import type { ResolvedCustomAgentFileConfig, ResolvedLauncherConfig } from "./schema.js";

export { CUSTOM_AGENT_ARGV_MAX_BYTES } from "./custom-agent.prompt.js";
export const CUSTOM_AGENT_ENV_MAX_BYTES = 32 * 1024;
export const CUSTOM_AGENT_ENV_HEADROOM_BYTES = 4 * 1024;
export const CUSTOM_AGENT_PROMPT_MAX_BYTES = 32 * 1024;

type CustomPromptKind = "initial" | "follow-up";

export interface CustomAgentLaunchOptions {
  prompt?: { kind: CustomPromptKind; text: string };
  startupEnv?: Record<string, string>;
}

export function validateCustomAgent(resolved: ResolvedLauncherConfig): void {
  validateCustomAgentForMode(resolved, resolved.startup.mode);
}

export function getCustomAgentFingerprint(agent: ResolvedLauncherConfig["agent"]): string {
  if (!agent) {
    throw new Error("Custom agent configuration is required to calculate its identity.");
  }
  return createHash("sha256").update(JSON.stringify(agent)).digest("hex");
}

export function validateCustomAgentForMode(
  resolved: ResolvedLauncherConfig,
  mode: StartupMode,
  promptKind?: CustomPromptKind,
): void {
  const agent = resolved.agent;
  if (mode !== "ssh-custom") {
    return;
  }
  if (!agent) {
    throw new Error("Invalid agent: required when startup.mode is 'ssh-custom'.");
  }

  validateCommandArgv(agent.command, "agent.command");
  validateTrustedCommand(agent.check_command, "agent.check_command");
  validateTrustedCommand(agent.install_command, "agent.install_command");
  if (agent.install_command !== undefined && agent.check_command === undefined) {
    throw new Error("Invalid agent.install_command: agent.check_command is required when installation is configured.");
  }
  validateInitialPromptCommand(agent.initial_prompt_command, promptKind, agent.command);
  validateCustomFiles(agent.files);
}

export function validateCustomAgentLaunch(
  resolved: ResolvedLauncherConfig,
  mode: StartupMode,
  options: CustomAgentLaunchOptions = {},
): void {
  validateCustomAgentForMode(resolved, mode, options.prompt?.kind);
  if (mode !== "ssh-custom" || !resolved.agent) {
    return;
  }
  if (options.prompt?.kind === "follow-up" && resolved.agent.follow_up !== "tmux") {
    throw new Error('Invalid agent.follow_up: follow-up prompts for ssh-custom require agent.follow_up = "tmux".');
  }

  const commandArgv =
    options.prompt?.kind === "initial" && resolved.agent.initial_prompt_command
      ? resolved.agent.initial_prompt_command.map((argument) =>
          argument === "{prompt}" ? (options.prompt?.text ?? "") : argument,
        )
      : resolved.agent.command;
  assertArgvByteLimit(commandArgv, "agent command argv");
  if (options.prompt && Buffer.byteLength(options.prompt.text, "utf8") > CUSTOM_AGENT_PROMPT_MAX_BYTES) {
    throw new Error(
      `Custom agent prompt is too large: ${Buffer.byteLength(options.prompt.text, "utf8")} UTF-8 bytes exceeds ${CUSTOM_AGENT_PROMPT_MAX_BYTES} bytes.`,
    );
  }
  if (options.startupEnv) {
    const environmentBytes = Object.entries(options.startupEnv).reduce(
      (total, [key, value]) => total + Buffer.byteLength(`${key}=${value}`, "utf8") + 1,
      0,
    );
    if (environmentBytes + CUSTOM_AGENT_ENV_HEADROOM_BYTES > CUSTOM_AGENT_ENV_MAX_BYTES) {
      throw new Error(
        `Custom agent environment is too large: ${environmentBytes} UTF-8 bytes plus ${CUSTOM_AGENT_ENV_HEADROOM_BYTES} bytes headroom exceeds ${CUSTOM_AGENT_ENV_MAX_BYTES} bytes.`,
      );
    }
  }
}

function validateCustomFiles(files: ResolvedCustomAgentFileConfig[]): void {
  const destinations = new Set<string>();
  for (const [index, file] of files.entries()) {
    if (file.source.includes("\0")) {
      throw new Error(`Invalid agent.files[${index}].source: NUL bytes are not allowed.`);
    }
    if (containsControlCharacter(file.destination)) {
      throw new Error(`Invalid agent.files[${index}].destination: control characters are not allowed.`);
    }
    if (!isSafeSandboxFilePath(file.destination)) {
      throw new Error(
        `Invalid agent.files[${index}].destination: expected an absolute path under /home/user without traversal or control characters.`,
      );
    }
    if (destinations.has(file.destination)) {
      throw new Error(`Invalid agent.files[${index}].destination: duplicate destination is not allowed.`);
    }
    destinations.add(file.destination);
  }
}

function validateTrustedCommand(command: string | undefined, path: string): void {
  if (command !== undefined && (command.trim() === "" || command.includes("\0"))) {
    throw new Error(`Invalid ${path}: expected a non-empty command without NUL bytes.`);
  }
}

export function isSafeSandboxFilePath(path: string): boolean {
  if (!posix.isAbsolute(path) || containsControlCharacter(path) || path === "/home/user") {
    return false;
  }
  if (!path.startsWith("/home/user/")) {
    return false;
  }
  return path
    .split("/")
    .slice(1)
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
