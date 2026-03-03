import { redactSensitiveText } from "../security/redaction.js";

export function toUserVisibleCliErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected CLI failure";
  return redactSensitiveText(message);
}
