type LogLevel = "info" | "warn" | "error";

let verboseEnabled = false;
let loadingFrame = 0;
let loadingIntervalId: NodeJS.Timeout | null = null;

const levelPrefix: Record<LogLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR"
};

const ansi = {
  reset: "\u001b[0m",
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
  red: "\u001b[31m"
} as const;

function isColorEnabled(output: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  const forceColor = process.env.FORCE_COLOR;
  if (forceColor !== undefined && forceColor !== "0") {
    return true;
  }

  return output.isTTY === true;
}

function formatPrefix(level: LogLevel, output: NodeJS.WriteStream): string {
  const prefix = `[${levelPrefix[level]}]`;
  if (!isColorEnabled(output)) {
    return prefix;
  }

  const color =
    level === "info" ? ansi.cyan : level === "warn" ? ansi.yellow : ansi.red;
  return `${color}${prefix}${ansi.reset}`;
}

function write(level: LogLevel, message: string): void {
  const output = level === "error" ? process.stderr : process.stdout;
  const line = `${formatPrefix(level, output)} ${message}`;
  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

export function setVerboseLoggingEnabled(enabled: boolean): void {
  verboseEnabled = enabled;
}

export const logger = {
  info(message: string): void {
    write("info", message);
  },
  verbose(message: string): void {
    if (!verboseEnabled) {
      return;
    }
    write("info", message);
  },
  warn(message: string): void {
    write("warn", message);
  },
  error(message: string): void {
    write("error", message);
  },
  startLoading(message: string): () => void {
    if (verboseEnabled || !process.stdout.isTTY) {
      write("info", message);
      return () => {};
    }

    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    loadingIntervalId = setInterval(() => {
      const frame = frames[loadingFrame % frames.length];
      process.stdout.write(`\r${frame} ${message}`);
      loadingFrame++;
    }, 80);

    return () => {
      if (loadingIntervalId) {
        clearInterval(loadingIntervalId);
        loadingIntervalId = null;
        process.stdout.write("\r");
      }
    };
  }
};
