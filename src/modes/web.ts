import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const WEB_COMMAND = "opencode serve --hostname 0.0.0.0 --port 3000";

export async function startWebMode(handle: SandboxHandle): Promise<ModeLaunchResult> {
  await handle.run(WEB_COMMAND);
  const host = await handle.getHost(3000);
  const url = ensureHttps(host);

  return {
    mode: "web",
    command: WEB_COMMAND,
    url,
    message: `Started web mode in sandbox ${handle.sandboxId} at ${url}`
  };
}

function ensureHttps(host: string): string {
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
  }

  return `https://${host}`;
}
