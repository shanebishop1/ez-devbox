import type { RetryPolicy } from "./retry.js";

export async function runSetupPipeline(_command: string, _policy: RetryPolicy): Promise<void> {
  throw new Error("Setup runner not implemented yet");
}
