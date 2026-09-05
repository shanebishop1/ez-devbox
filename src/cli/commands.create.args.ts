import type { StartupMode } from "../types/index.js";
import { parseStartupModeValue } from "./command-shared.js";

export interface CreateCommandArgs {
  mode?: StartupMode;
  json: boolean;
  detach: boolean;
  promptFile?: string;
  promptStdin: boolean;
}

export function parseCreateArgs(args: string[]): CreateCommandArgs {
  let mode: StartupMode | undefined;
  let json = false;
  let detach = false;
  let promptFile: string | undefined;
  let promptStdin = false;

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

    if (token === "--detach") {
      detach = true;
      continue;
    }

    if (token === "--prompt-file") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --prompt-file.");
      }
      promptFile = next;
      index += 1;
      continue;
    }

    if (token === "--prompt-stdin") {
      promptStdin = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option for create: '${token}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for create: '${token}'. Use --help for usage.`);
  }

  if (promptFile && promptStdin) {
    throw new Error("Use only one of --prompt-file or --prompt-stdin.");
  }
  return { mode, json, detach, promptFile, promptStdin };
}
