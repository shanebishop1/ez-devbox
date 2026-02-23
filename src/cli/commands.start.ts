import type { CommandResult } from "../types/index.js";
import { runConnectCommand, type ConnectCommandDeps } from "./commands.connect.js";

export async function runStartCommand(args: string[], deps?: ConnectCommandDeps): Promise<CommandResult> {
  const noReuse = args.includes("--no-reuse");
  const forwardArgs = args.filter((arg) => arg !== "--no-reuse");

  return runConnectCommand(forwardArgs, deps, {
    skipLastRun: noReuse
  });
}
