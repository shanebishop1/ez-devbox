#!/usr/bin/env node

import { buildTemplateDefinition, renderTemplatePlanLines } from "./template.js";

interface CliFlags {
  alias?: string;
  withGhTooling: boolean;
  withSshStack: boolean;
}

function readCliFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    withGhTooling: false,
    withSshStack: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--alias") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--alias requires a value");
      }
      flags.alias = value;
      i += 1;
      continue;
    }

    if (token === "--with-gh") {
      flags.withGhTooling = true;
      continue;
    }

    if (token === "--with-ssh") {
      flags.withSshStack = true;
      continue;
    }
  }

  return flags;
}

function main(): void {
  const flags = readCliFlags(process.argv.slice(2));
  const definition = buildTemplateDefinition({
    alias: flags.alias,
    withGhTooling: flags.withGhTooling,
    withSshStack: flags.withSshStack
  });

  const planLines = renderTemplatePlanLines(definition);
  for (const line of planLines) {
    console.log(line);
  }
}

main();
