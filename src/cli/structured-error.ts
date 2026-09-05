import { redactSensitiveText } from "../security/redaction.js";

export class StructuredCliError extends Error {
  readonly code: string;
  readonly stage: string;
  readonly sandboxId?: string;
  readonly cause: unknown;

  constructor(code: string, stage: string, message: string, options: { sandboxId?: string; cause?: unknown } = {}) {
    super(redactSensitiveText(message));
    this.name = "StructuredCliError";
    this.code = code;
    this.stage = stage;
    this.sandboxId = options.sandboxId;
    this.cause = options.cause;
  }
}

export function asStructuredCliError(
  error: unknown,
  fallback: { code: string; stage: string; sandboxId?: string },
): StructuredCliError {
  if (error instanceof StructuredCliError) {
    return error;
  }
  const message = error instanceof Error && error.message.trim() !== "" ? error.message : "Unknown error.";
  return new StructuredCliError(fallback.code, fallback.stage, message, {
    sandboxId: fallback.sandboxId,
    cause: error,
  });
}

export function serializeCliError(error: unknown): {
  error: { code: string; stage: string; message: string; sandboxId?: string };
} {
  const structured = asStructuredCliError(error, { code: "CLI_ERROR", stage: "cli" });
  return {
    error: {
      code: structured.code,
      stage: structured.stage,
      message: structured.message,
      ...(structured.sandboxId ? { sandboxId: structured.sandboxId } : {}),
    },
  };
}

export function createFailureCode(stage: string): "AGENT_START_FAILED" | "CREATE_SETUP_FAILED" {
  return stage === "agent-startup" || stage === "initial-prompt" ? "AGENT_START_FAILED" : "CREATE_SETUP_FAILED";
}
