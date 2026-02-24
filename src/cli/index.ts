#!/usr/bin/env node

import { logger, setVerboseLoggingEnabled } from "../logging/logger.js";
import { runCommandCommand } from "./commands.command.js";
import { runConnectCommand } from "./commands.connect.js";
import { runCreateCommand } from "./commands.create.js";
import { runListCommand } from "./commands.list.js";
import { runResumeCommand } from "./commands.resume.js";
import { runWipeCommand } from "./commands.wipe.js";
import { runWipeAllCommand } from "./commands.wipe-all.js";
import { parseGlobalCliOptions, renderHelp, resolveCliCommand } from "./router.js";

export async function runCli(argv: string[]): Promise<number> {
  try {
    const globalOptions = parseGlobalCliOptions(argv);
    setVerboseLoggingEnabled(globalOptions.verbose);
    const resolved = resolveCliCommand(globalOptions.args);

    if (resolved.command === "help") {
      logger.info(renderHelp());
      return 0;
    }

    if (resolved.command === "create") {
      const result = await runCreateCommand(resolved.args);
      logger.info(result.message);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "connect") {
      const result = await runConnectCommand(resolved.args);
      logger.info(result.message);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "resume") {
      const result = await runResumeCommand(resolved.args);
      logger.info(result.message);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "list") {
      const result = await runListCommand(resolved.args);
      logger.info(result.message);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "command") {
      const result = await runCommandCommand(resolved.args);
      logger.info(result.message);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "wipe") {
      const result = await runWipeCommand(resolved.args);
      logger.info(result.message);
      return result.exitCode ?? 0;
    }

    if (resolved.command === "wipe-all") {
      const result = await runWipeAllCommand(resolved.args);
      logger.info(result.message);
      return result.exitCode ?? 0;
    }

    throw new Error(`Unknown command: ${resolved.command}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected CLI failure";
    logger.error(message);
    return 1;
  }
}

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
