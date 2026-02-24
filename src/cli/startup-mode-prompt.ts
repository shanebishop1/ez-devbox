import { createInterface } from "node:readline/promises";
import type { StartupMode } from "../types/index.js";
import { normalizePromptCancelledError } from "./prompt-cancelled.js";
import { formatPromptChoice, formatPromptHeader } from "./prompt-style.js";

const PROMPT_FALLBACK_MODE: Exclude<StartupMode, "prompt"> = "ssh-opencode";
const PROMPT_CHOICE_NUMBERS: Record<string, Exclude<StartupMode, "prompt">> = {
  "1": "ssh-opencode",
  "2": "ssh-codex",
  "3": "web",
  "4": "ssh-shell"
};

export interface StartupModePromptDeps {
  isInteractiveTerminal: () => boolean;
  promptInput: (question: string) => Promise<string>;
}

const defaultDeps: StartupModePromptDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  promptInput: promptInput
};

export async function resolvePromptStartupMode(
  requestedMode: StartupMode,
  deps: StartupModePromptDeps = defaultDeps
): Promise<StartupMode> {
  if (requestedMode !== "prompt") {
    return requestedMode;
  }

  if (!deps.isInteractiveTerminal()) {
    return PROMPT_FALLBACK_MODE;
  }

  const question = [
    formatPromptHeader("ez-devbox"),
    "Select startup mode:",
    formatPromptChoice(1, "ssh-opencode"),
    formatPromptChoice(2, "ssh-codex"),
    formatPromptChoice(3, "web"),
    formatPromptChoice(4, "ssh-shell"),
    `Enter choice [1/${PROMPT_FALLBACK_MODE}]: `
  ].join("\n");
  const answer = (await deps.promptInput(question)).trim().toLowerCase();
  const resolved = resolvePromptAnswer(answer);

  if (resolved) {
    return resolved;
  }

  return PROMPT_FALLBACK_MODE;
}

function isConcreteStartupMode(value: string): value is Exclude<StartupMode, "prompt"> {
  return value === "ssh-opencode" || value === "ssh-codex" || value === "web" || value === "ssh-shell";
}

function resolvePromptAnswer(value: string): Exclude<StartupMode, "prompt"> | undefined {
  if (isConcreteStartupMode(value)) {
    return value;
  }

  return PROMPT_CHOICE_NUMBERS[value];
}

async function promptInput(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await readline.question(question);
  } catch (error) {
    const cancelledError = normalizePromptCancelledError(error, "Startup mode selection cancelled.");
    if (cancelledError) {
      throw cancelledError;
    }
    throw error;
  } finally {
    readline.close();
  }
}
