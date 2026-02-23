import type { CommandResult } from "../types/index.js";

export async function runStartCommand(args: string[]): Promise<CommandResult> {
  return {
    message: `start command placeholder invoked with args: ${args.join(" ") || "(none)"}`,
    exitCode: 0
  };
}
