export interface CommandCommandArgs {
  sandboxId?: string;
  command: string;
  json: boolean;
}

export function parseCommandArgs(args: string[]): CommandCommandArgs {
  let sandboxId: string | undefined;
  let json = false;
  let commandStartIndex = args.length;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--") {
      commandStartIndex = index + 1;
      break;
    }

    if (token === "--sandbox-id") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --sandbox-id.");
      }
      sandboxId = next;
      index += 1;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option for command: '${token}'. Use --help for usage.`);
    }

    commandStartIndex = index;
    break;
  }

  const commandTokens = args.slice(commandStartIndex);
  if (commandTokens.length === 0) {
    throw new Error("Missing remote command. Provide a command after options (use -- when needed).");
  }

  return {
    sandboxId,
    command: commandTokens.join(" "),
    json,
  };
}
