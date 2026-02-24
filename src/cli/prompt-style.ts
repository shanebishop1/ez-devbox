const ANSI_RESET = "\u001b[0m";
const ANSI_BLUE = "\u001b[34m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_ORANGE = "\u001b[38;5;208m";

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

export function formatPromptChoice(index: number, label: string, output: NodeJS.WriteStream = process.stdout): string {
  const color = index % 2 === 1 ? ANSI_BLUE : ANSI_GREEN;
  return `${colorize(String(index), color, output)}) ${label}`;
}
