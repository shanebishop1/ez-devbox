export function normalizeTimeoutMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Timeout must be a positive number");
  }

  return Math.floor(value);
}
