export class PromptCancelledError extends Error {
  constructor(message = "Prompt cancelled.", options?: ErrorOptions) {
    super(message, options);
    this.name = "PromptCancelledError";
  }
}

export function isPromptCancelledError(error: unknown): error is PromptCancelledError {
  if (error instanceof PromptCancelledError) {
    return true;
  }

  return typeof error === "object" && error !== null && "name" in error && error.name === "PromptCancelledError";
}

export function normalizePromptCancelledError(
  error: unknown,
  message = "Prompt cancelled."
): PromptCancelledError | undefined {
  if (isPromptCancelledError(error)) {
    return error;
  }

  if (!isReadlineCancellationError(error)) {
    return undefined;
  }

  return new PromptCancelledError(message, { cause: error });
}

function isReadlineCancellationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof maybeError.name === "string" ? maybeError.name : "";
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  const message = typeof maybeError.message === "string" ? maybeError.message : "";

  if (name === "AbortError" || name === "ExitPromptError") {
    return true;
  }

  if (code === "ABORT_ERR" || code === "ERR_CANCELED" || code === "ERR_CANCELLED") {
    return true;
  }

  return /\babort(?:ed)?\b|\bcancel(?:ed|led)?\b|\bsigint\b/i.test(message);
}
