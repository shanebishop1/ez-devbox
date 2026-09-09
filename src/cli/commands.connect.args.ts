import type { StartupMode } from "../types/index.js";
import { parseCommandArgs } from "./command-args.js";

export interface ConnectCommandArgs {
  sandboxId?: string;
  mode?: StartupMode;
  json: boolean;
  detach: boolean;
  promptFile?: string;
  promptStdin: boolean;
}

export interface ConnectCommandOptions {
  skipLastRun?: boolean;
  skipDetachHint?: boolean;
  skipInteractiveHeader?: boolean;
}

export function parseConnectArgs(args: string[]): ConnectCommandArgs {
  return parseCommandArgs(args, { commandName: "connect", allowSandboxId: true });
}
