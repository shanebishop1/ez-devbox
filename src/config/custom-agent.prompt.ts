import { posix } from "node:path";
import {
  assertExpectedAgentExecutable,
  assertPromptTargetIsDataOnly,
  resolveCustomAgentExecutable,
  resolvePromptTarget,
} from "./custom-agent.prompt-target.js";

export { resolveCustomAgentExecutable } from "./custom-agent.prompt-target.js";

export const CUSTOM_AGENT_ARGV_MAX_BYTES = 16 * 1024;

export type CustomPromptKind = "initial" | "follow-up";

const SHELL_EXECUTABLES = new Set([
  "ash",
  "bash",
  "cmd",
  "csh",
  "dash",
  "fish",
  "ksh",
  "ksh93",
  "mksh",
  "nu",
  "oil",
  "osh",
  "pdksh",
  "powershell",
  "pwsh",
  "sh",
  "tcsh",
  "xonsh",
  "yash",
  "zsh",
]);

export function isSafeShellPromptWrapper(argv: string[], placeholderIndex = argv.indexOf("{prompt}")): boolean {
  if (
    placeholderIndex !== 4 ||
    argv.length !== 5 ||
    posix.basename(argv[0] ?? "").toLowerCase() !== "bash" ||
    argv[1] !== "-c"
  ) {
    return false;
  }
  const commandMatch = (argv[2] ?? "").match(/^exec ([A-Za-z0-9_@%+=:,./-]+(?: [A-Za-z0-9_@%+=:,./-]+)*) "\$1"$/);
  if (!commandMatch) {
    return false;
  }

  const commandWords = commandMatch[1]?.split(" ") ?? [];
  const executable = commandWords[0] ?? "";
  return (
    executable !== "" &&
    !executable.startsWith("-") &&
    commandWords.every((word) => !isShellExecutable(word)) &&
    posix.basename(executable).toLowerCase() !== "env"
  );
}

export function isShellExecutable(argument: string): boolean {
  return SHELL_EXECUTABLES.has(posix.basename(argument).toLowerCase());
}

export function validateInitialPromptCommand(
  argv: string[] | undefined,
  promptKind?: CustomPromptKind,
  expectedAgentCommand?: string[],
): void {
  if (argv === undefined) {
    if (promptKind === "initial") {
      throw new Error("Invalid agent.initial_prompt_command: required for initial prompts.");
    }
    return;
  }
  validateCommandArgv(argv, "agent.initial_prompt_command");
  if (argv.some((argument) => argument !== "{prompt}" && argument.includes("{prompt}"))) {
    throw new Error("Invalid agent.initial_prompt_command: '{prompt}' must be a whole argument.");
  }
  const placeholderCount = argv.filter((argument) => argument === "{prompt}").length;
  if (placeholderCount !== 1) {
    throw new Error(
      "Invalid agent.initial_prompt_command: expected exactly one whole-argument '{prompt}' placeholder.",
    );
  }
  const placeholderIndex = argv.indexOf("{prompt}");
  const expectedAgentExecutable = expectedAgentCommand ? resolveCustomAgentExecutable(expectedAgentCommand) : undefined;
  if (expectedAgentCommand && !expectedAgentExecutable) {
    throw new Error(
      "Invalid agent.command: effective executable must be unambiguous when agent.initial_prompt_command is configured.",
    );
  }
  if (placeholderIndex === 0) {
    throw new Error("Invalid agent.initial_prompt_command: '{prompt}' cannot be the executable.");
  }
  if (isSafeShellPromptWrapper(argv, placeholderIndex)) {
    const commandWords = argv[2]?.split(" ").slice(1) ?? [];
    assertPromptTargetIsDataOnly(commandWords[0], commandWords, commandWords.length - 1, 0, expectedAgentCommand);
    assertExpectedAgentExecutable(commandWords[0], expectedAgentExecutable);
    assertArgvByteLimit(argv, "agent.initial_prompt_command");
    return;
  }
  const target = resolvePromptTarget(argv, placeholderIndex);
  const executable = target?.executable;
  if (executable === "{prompt}") {
    throw new Error("Invalid agent.initial_prompt_command: '{prompt}' cannot be the executable.");
  }
  if (executable === undefined || isShellExecutable(executable)) {
    throw new Error(
      "Invalid agent.initial_prompt_command: shell executables and shell program options cannot receive '{prompt}' as code.",
    );
  }
  assertPromptTargetIsDataOnly(executable, argv, placeholderIndex, target?.index, expectedAgentCommand);
  assertExpectedAgentExecutable(executable, expectedAgentExecutable);
  assertArgvByteLimit(argv, "agent.initial_prompt_command");
}

export function validateCommandArgv(argv: string[], path: string): void {
  if (argv.length === 0) {
    throw new Error(`Invalid ${path}: expected a non-empty argv array.`);
  }
  if (argv[0]?.trim() === "") {
    throw new Error(`Invalid ${path}[0]: executable must be non-empty.`);
  }
  if (argv.some((argument) => argument.includes("\0"))) {
    throw new Error(`Invalid ${path}: NUL bytes are not allowed.`);
  }
}

export function assertArgvByteLimit(argv: string[], label: string): void {
  const bytes = argv.reduce((total, argument) => total + Buffer.byteLength(argument, "utf8") + 1, 0);
  if (bytes > CUSTOM_AGENT_ARGV_MAX_BYTES) {
    throw new Error(`Custom ${label} is too large: ${bytes} UTF-8 bytes exceeds ${CUSTOM_AGENT_ARGV_MAX_BYTES} bytes.`);
  }
}
