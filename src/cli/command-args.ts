import type { StartupMode } from "../types/index.js";
import { parseStartupModeValue } from "./command-shared.js";

export interface ParsedCommandArgs {
  sandboxId?: string;
  mode?: StartupMode;
  json: boolean;
  detach: boolean;
  promptFile?: string;
  promptStdin: boolean;
}

export interface ParseCommandArgsOptions {
  commandName: string;
  allowSandboxId?: boolean;
  allowLegacySync?: boolean;
}

export function parseCommandArgs(args: string[], options: ParseCommandArgsOptions): ParsedCommandArgs {
  let sandboxId: string | undefined;
  let mode: StartupMode | undefined;
  let json = false;
  let detach = false;
  let promptFile: string | undefined;
  let promptStdin = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--sandbox-id" && options.allowSandboxId) {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --sandbox-id.");
      }
      sandboxId = next;
      index += 1;
      continue;
    }

    if (token === "--mode") {
      mode = parseStartupModeValue(args[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--yes-sync" && options.allowLegacySync) {
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
      throw new Error(`Unknown option for ${options.commandName}: '${token}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for ${options.commandName}: '${token}'. Use --help for usage.`);
  }

  if (promptFile && promptStdin) {
    throw new Error("Use only one of --prompt-file or --prompt-stdin.");
  }

  return { sandboxId, mode, json, detach, promptFile, promptStdin };
}
