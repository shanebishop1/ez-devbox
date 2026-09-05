export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildArgvCommand(argv: string[]): string {
  if (argv.length === 0) {
    throw new Error("Cannot build an empty argv command.");
  }

  return argv.map((value) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : quoteShellArg(value))).join(" ");
}
