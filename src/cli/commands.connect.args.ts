import type { StartupMode } from "../types/index.js";
import { parseStartupModeValue } from "./command-shared.js";

export interface ConnectCommandArgs {
  sandboxId?: string;
  mode?: StartupMode;
  json: boolean;
}

export function parseConnectArgs(args: string[]): ConnectCommandArgs {
  let sandboxId: string | undefined;
  let mode: StartupMode | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--sandbox-id") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --sandbox-id.");
      }
      sandboxId = next;
      index += 1;
      continue;
    }

    if (token === "--mode") {
      const next = args[index + 1];
      mode = parseStartupModeValue(next);
      index += 1;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option for connect: '${token}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for connect: '${token}'. Use --help for usage.`);
  }

  return { sandboxId, mode, json };
}
