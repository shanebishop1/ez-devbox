export type RemoteInvocation =
  | { kind: "argv"; argv: string[] }
  | { kind: "shell"; script?: string; scriptFile?: string };

export interface CommandCommandArgs {
  sandboxId?: string;
  invocation: RemoteInvocation;
  json: boolean;
  timeoutMs?: number;
}

export function parseCommandArgs(args: string[]): CommandCommandArgs {
  let sandboxId: string | undefined;
  let json = false;
  let timeoutMs: number | undefined;
  let invocation: RemoteInvocation | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") {
      invocation = { kind: "argv", argv: args.slice(index + 1) };
      break;
    }
    if (token === "--sandbox-id") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --sandbox-id.");
      sandboxId = next;
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      const next = args[index + 1];
      const parsed = Number(next);
      if (!next || !Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error("--timeout-ms must be a positive integer.");
      }
      timeoutMs = parsed;
      index += 1;
      continue;
    }
    if (token === "--shell") {
      const script = args[index + 1];
      if (script === undefined) throw new Error("Missing value for --shell.");
      invocation = { kind: "shell", script };
      if (index + 2 !== args.length) throw new Error("--shell accepts one script argument.");
      break;
    }
    if (token === "--shell-file") {
      const scriptFile = args[index + 1];
      if (!scriptFile || scriptFile.startsWith("--")) throw new Error("Missing value for --shell-file.");
      invocation = { kind: "shell", scriptFile };
      if (index + 2 !== args.length) throw new Error("--shell-file accepts one path.");
      break;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`Unknown option for command: '${token}'. Use --help for usage.`);
    }
    invocation = { kind: "argv", argv: args.slice(index) };
    break;
  }

  if (!invocation || (invocation.kind === "argv" && invocation.argv.length === 0)) {
    throw new Error("Missing remote command. Provide argv after --, or use --shell/--shell-file.");
  }
  return { sandboxId, invocation, json, timeoutMs };
}
