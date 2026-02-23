export function isHelpFlag(token?: string): boolean {
  return token === "--help" || token === "-h" || token === "help";
}
