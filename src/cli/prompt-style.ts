const ANSI_RESET = "\u001b[0m";
const ANSI_BLUE = "\u001b[34m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_ORANGE = "\u001b[38;5;208m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_YELLOW = "\u001b[33m";
const PROMPT_WIZARD_CLEAR = "\u001b[2J\u001b[H";

export const SSH_SUSPEND_RESUME_HINT =
  "For SSH modes: press Ctrl+b d to suspend; use ez-devbox connect or ez-devbox resume to continue.";

function isPromptColorEnabled(output: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  const forceColor = process.env.FORCE_COLOR;
  if (forceColor !== undefined && forceColor !== "0") {
    return true;
  }

  return output.isTTY === true;
}

function colorize(text: string, style: string, output: NodeJS.WriteStream): string {
  if (!isPromptColorEnabled(output)) {
    return text;
  }

  return `${style}${text}${ANSI_RESET}`;
}

export function formatPromptHeader(text: string, output: NodeJS.WriteStream = process.stdout): string {
  return colorize(text, ANSI_ORANGE, output);
}

export function formatPromptHeaderBox(text: string, output: NodeJS.WriteStream = process.stdout): string {
  const content = ` ${text} `;
  const border = `+${"-".repeat(content.length)}+`;
  return colorize([border, `|${content}|`, border].join("\n"), ANSI_ORANGE, output);
}

export function renderPromptWizardHeader(text: string, output: NodeJS.WriteStream = process.stdout): string {
  return `${PROMPT_WIZARD_CLEAR}${formatPromptHeaderBox(text, output)}`;
}

export function formatPromptSectionHeader(text: string): string {
  return [text, "-".repeat(text.length)].join("\n");
}

export function formatPromptChoice(index: number, label: string, output: NodeJS.WriteStream = process.stdout): string {
  const color = index % 2 === 1 ? ANSI_BLUE : ANSI_GREEN;
  return `${colorize(String(index), color, output)}) ${label}`;
}

export function formatPromptLogTag(level: "info" | "warn", output: NodeJS.WriteStream = process.stdout): string {
  const color = level === "info" ? ANSI_CYAN : ANSI_YELLOW;
  return colorize(`[${level.toUpperCase()}]`, color, output);
}
