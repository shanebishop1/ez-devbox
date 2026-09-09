import { posix } from "node:path";

const PROMPT_DISPATCH_EXECUTABLES = new Set([
  "busybox",
  "chrt",
  "ionice",
  "nice",
  "nohup",
  "setsid",
  "stdbuf",
  "sudo",
  "taskset",
  "timeout",
  "toybox",
  "xargs",
]);
export interface ResolvedPromptTarget {
  executable: string;
  index: number;
}

export function resolveCustomAgentExecutable(argv: string[]): string | undefined {
  return resolvePromptTarget(argv, argv.length)?.executable;
}

export function resolvePromptTarget(argv: string[], placeholderIndex: number): ResolvedPromptTarget | undefined {
  if (posix.basename(argv[0] ?? "").toLowerCase() !== "env") {
    return argv[0] === undefined ? undefined : { executable: argv[0], index: 0 };
  }

  for (let index = 1; index <= placeholderIndex; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--") {
      const executable = argv[index + 1];
      return executable === undefined ? undefined : { executable, index: index + 1 };
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argument)) {
      continue;
    }
    if (argument.includes("=")) {
      return undefined;
    }
    if (argument === "-i" || argument === "--ignore-environment" || argument === "-0" || argument === "--null") {
      continue;
    }
    if (argument === "-u" || argument === "--unset" || argument === "-C" || argument === "--chdir") {
      index += 1;
      continue;
    }
    if (argument.startsWith("--unset=") || argument.startsWith("--chdir=")) {
      continue;
    }
    if (
      argument === "-S" ||
      argument === "--split-string" ||
      argument.startsWith("--split-string=") ||
      argument.startsWith("-")
    ) {
      return undefined;
    }
    return { executable: argument, index };
  }

  return undefined;
}

export function assertExpectedAgentExecutable(actual: string | undefined, expected: string | undefined): void {
  if (!expected) {
    return;
  }
  const actualExecutable = actual ?? "";
  const executableMatches =
    actualExecutable.includes("/") || expected.includes("/")
      ? actualExecutable === expected
      : posix.basename(actualExecutable) === posix.basename(expected);
  if (!executableMatches) {
    throw new Error("Invalid agent.initial_prompt_command: executable must match agent.command.");
  }
}

export function assertPromptTargetIsDataOnly(
  executable: string | undefined,
  argv: string[],
  placeholderIndex: number,
  executableIndex = 0,
  expectedAgentCommand?: string[],
): void {
  const executableName = posix.basename(executable ?? "").toLowerCase();
  if (PROMPT_DISPATCH_EXECUTABLES.has(executableName)) {
    throw new Error(
      "Invalid agent.initial_prompt_command: dispatch utilities and program options cannot receive '{prompt}' as code.",
    );
  }
  if (!isRecognizedInterpreter(executableName)) {
    return;
  }

  const expectedPrefix = resolveInterpreterScriptPrefix(expectedAgentCommand ?? []);
  const promptArguments = argv.slice(executableIndex, placeholderIndex);
  if (
    expectedPrefix === undefined ||
    expectedPrefix.slice(1).some((argument, index) => promptArguments[index + 1] !== argument)
  ) {
    throw new Error(
      "Invalid agent.initial_prompt_command: a recognized interpreter script-file form must precede '{prompt}'; program options cannot receive it as code.",
    );
  }
}

function resolveInterpreterScriptPrefix(argv: string[]): string[] | undefined {
  const target = resolvePromptTarget(argv, argv.length);
  if (!target || !isRecognizedInterpreter(posix.basename(target.executable).toLowerCase())) {
    return undefined;
  }
  const firstArgument = argv[target.index + 1];
  if (firstArgument === "-m") {
    const moduleName = argv[target.index + 2];
    return moduleName && !moduleName.startsWith("-") ? [target.executable, firstArgument, moduleName] : undefined;
  }
  return firstArgument && !firstArgument.startsWith("-") ? [target.executable, firstArgument] : undefined;
}

function isRecognizedInterpreter(executableName: string): boolean {
  return /^(?:bun|julia|lua|node(?:js)?|perl|php|pypy\d*|python\d*(?:\.\d+)*|rscript|ruby)$/.test(executableName);
}
