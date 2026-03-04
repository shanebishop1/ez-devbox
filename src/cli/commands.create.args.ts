import type { StartupMode } from "../types/index.js";
import { parseStartupModeValue } from "./command-shared.js";

export interface CreateCommandArgs {
  mode?: StartupMode;
  json: boolean;
}

export function parseCreateArgs(args: string[]): CreateCommandArgs {
  let mode: StartupMode | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--mode") {
      const next = args[index + 1];
      mode = parseStartupModeValue(next);
      index += 1;
      continue;
    }

    if (token === "--yes-sync") {
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option for create: '${token}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for create: '${token}'. Use --help for usage.`);
  }

  return { mode, json };
}
