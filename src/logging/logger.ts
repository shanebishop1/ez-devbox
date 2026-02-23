type LogLevel = "info" | "warn" | "error";

const levelPrefix: Record<LogLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR"
};

function write(level: LogLevel, message: string): void {
  const line = `[${levelPrefix[level]}] ${message}`;
  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info(message: string): void {
    write("info", message);
  },
  warn(message: string): void {
    write("warn", message);
  },
  error(message: string): void {
    write("error", message);
  }
};
