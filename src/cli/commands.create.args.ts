import type { StartupMode } from "../types/index.js";
import { parseCommandArgs } from "./command-args.js";

export interface CreateCommandArgs {
  mode?: StartupMode;
  json: boolean;
  detach: boolean;
  promptFile?: string;
  promptStdin: boolean;
}

export function parseCreateArgs(args: string[]): CreateCommandArgs {
  const { mode, json, detach, promptFile, promptStdin } = parseCommandArgs(args, {
    commandName: "create",
    allowLegacySync: true,
  });
  return { mode, json, detach, promptFile, promptStdin };
}
