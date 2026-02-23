#!/usr/bin/env node

import { logger } from "../logging/logger.js";
import { runConnectCommand } from "./commands.connect.js";
import { runCreateCommand } from "./commands.create.js";
import { runStartCommand } from "./commands.start.js";
import { renderHelp, resolveCliCommand } from "./router.js";

export async function runCli(argv: string[]): Promise<number> {
  try {
    const resolved = resolveCliCommand(argv);

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

    const result = await runStartCommand(resolved.args);
    logger.info(result.message);
    return result.exitCode ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected CLI failure";
    logger.error(message);
    return 1;
  }
}

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
