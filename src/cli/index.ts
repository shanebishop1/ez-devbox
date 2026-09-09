#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logger, setJsonOutputEnabled, setVerboseLoggingEnabled } from "../logging/logger.js";
import type { CommandResult } from "../types/index.js";
import { runCommandCommand } from "./commands.command.js";
import { runConnectCommand } from "./commands.connect.js";
import { runCreateCommand } from "./commands.create.js";
import { runListCommand } from "./commands.list.js";
import { runResumeCommand } from "./commands.resume.js";
import { runWipeCommand } from "./commands.wipe.js";
import { runWipeAllCommand } from "./commands.wipe-all.js";
import { toUserVisibleCliErrorMessage } from "./error-message.js";
import { parseGlobalCliOptions, renderHelp, resolveCliCommand } from "./router.js";
import { serializeCliError } from "./structured-error.js";
import { readCliVersion } from "./version.js";

export async function runCli(argv: string[]): Promise<number> {
  const jsonOutputRequested = isJsonOutputRequested(argv);
  setJsonOutputEnabled(jsonOutputRequested);
  try {
    const globalOptions = parseGlobalCliOptions(argv);
    setVerboseLoggingEnabled(globalOptions.verbose);
    const resolved = resolveCliCommand(globalOptions.args);

    if (resolved.command === "help") {
      process.stdout.write(`${renderHelp()}\n`);
      return 0;
    }

    if (resolved.command === "version") {
      process.stdout.write(`${readCliVersion()}\n`);
      return 0;
    }

    if (resolved.command === "create") {
      const result = await runCreateCommand(resolved.args);
      printCommandResult(result);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "connect") {
      const result = await runConnectCommand(resolved.args);
      printCommandResult(result);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "resume") {
      const result = await runResumeCommand(resolved.args);
      printCommandResult(result);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "list") {
      const result = await runListCommand(resolved.args);
      if (result.json) {
        printCommandResult(result);
      } else if (result.message === "No sandboxes found.") {
        logger.info(result.message);
      } else {
        process.stdout.write(`${result.message}\n`);
      }
      return result.exitCode ?? 0;
    }

    if (resolved.command === "command") {
      const result = await runCommandCommand(resolved.args);
      printCommandResult(result);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "wipe") {
      const result = await runWipeCommand(resolved.args);
      printCommandResult(result);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "wipe-all") {
      const result = await runWipeAllCommand(resolved.args);
      printCommandResult(result);
      return result.exitCode ?? 0;
    }

    throw new Error(`Unknown command: ${resolved.command}.`);
  } catch (error) {
    const message = toUserVisibleCliErrorMessage(error);
    if (jsonOutputRequested) {
      process.stdout.write(`${JSON.stringify(serializeCliError(error), null, 2)}\n`);
    } else {
      logger.error(message);
    }
    return 1;
  } finally {
    setJsonOutputEnabled(false);
  }
}

function printCommandResult(result: CommandResult): void {
  if (result.json) {
    process.stdout.write(`${result.message}\n`);
    return;
  }

  logger.info(result.message);
  for (const line of result.postMessages ?? []) {
    logger.info(line);
  }
}

function isJsonOutputRequested(argv: string[]): boolean {
  const commandIndex = argv.findIndex((token) => ["create", "connect", "list", "ls", "command"].includes(token));
  if (commandIndex < 0) {
    return false;
  }

  const command = argv[commandIndex];
  for (const token of argv.slice(commandIndex + 1)) {
    if (command === "command" && token === "--") {
      return false;
    }
    if (token === "--json") {
      return true;
    }
  }
  return false;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) {
    return false;
  }

  try {
    const entrypointUrl = pathToFileURL(realpathSync(entrypoint)).href;
    const moduleUrl = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
    return entrypointUrl === moduleUrl;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
