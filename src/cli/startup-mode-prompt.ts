import { createInterface } from "node:readline/promises";
import type { StartupMode } from "../types/index.js";
import { isPromptCancelledError, normalizePromptCancelledError } from "./prompt-cancelled.js";
import { formatPromptChoice, formatPromptSectionHeader, renderPromptWizardHeader } from "./prompt-style.js";

const PROMPT_FALLBACK_MODE: Exclude<StartupMode, "prompt"> = "ssh-opencode";
const PROMPT_MAX_ATTEMPTS = 3;
const WEB_PROMPT_LABEL = "web-opencode";
const PROMPT_CHOICE_NUMBERS: Record<string, Exclude<StartupMode, "prompt">> = {
  "1": "ssh-opencode",
  "2": "ssh-claude",
  "3": "ssh-codex",
  "4": "web",
  "5": "ssh-shell",
};

export interface StartupModePromptDeps {
  isInteractiveTerminal: () => boolean;
  promptInput: (question: string) => Promise<string>;
}

export interface StartupModePromptOptions {
  prefaceLines?: string[];
}

const defaultDeps: StartupModePromptDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  promptInput: promptInput,
};

export async function resolvePromptStartupMode(
  requestedMode: StartupMode,
  deps: StartupModePromptDeps = defaultDeps,
  options: StartupModePromptOptions = {},
): Promise<StartupMode> {
  if (requestedMode !== "prompt") {
    return requestedMode;
  }

  if (!deps.isInteractiveTerminal()) {
    return PROMPT_FALLBACK_MODE;
  }

  const question = [
    renderPromptWizardHeader("ez-devbox"),
    ...(options.prefaceLines && options.prefaceLines.length > 0 ? ["", ...options.prefaceLines] : []),
    "",
    formatPromptSectionHeader("Select startup mode:"),
    formatPromptChoice(1, "ssh-opencode"),
    formatPromptChoice(2, "ssh-claude"),
    formatPromptChoice(3, "ssh-codex"),
    formatPromptChoice(4, WEB_PROMPT_LABEL),
    formatPromptChoice(5, "ssh-shell"),
    "",
    "Enter choice: ",
  ].join("\n");
  for (let attempt = 0; attempt < PROMPT_MAX_ATTEMPTS; attempt += 1) {
    let answer: string;
    try {
      answer = (await deps.promptInput(question)).trim().toLowerCase();
    } catch (error) {
      if (isPromptCancelledError(error) && process.stdout.isTTY) {
        process.stdout.write("\n");
      }
      throw error;
    }
    const resolved = resolvePromptAnswer(answer);

    if (resolved) {
      return resolved;
    }
  }

  throw new Error(
    `Invalid startup mode selection after ${PROMPT_MAX_ATTEMPTS} attempts. Expected one of ssh-opencode|ssh-claude|ssh-codex|${WEB_PROMPT_LABEL}|ssh-shell.`,
  );
}

function isConcreteStartupMode(value: string): value is Exclude<StartupMode, "prompt"> {
  return (
    value === "ssh-opencode" ||
    value === "ssh-codex" ||
    value === "ssh-claude" ||
    value === "web" ||
    value === "ssh-shell"
  );
}

function resolvePromptAnswer(value: string): Exclude<StartupMode, "prompt"> | undefined {
  if (value === WEB_PROMPT_LABEL) {
    return "web";
  }

  if (isConcreteStartupMode(value)) {
    return value;
  }

  return PROMPT_CHOICE_NUMBERS[value];
}

async function promptInput(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
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
