import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const WEB_COMMAND = "nohup opencode serve --hostname 0.0.0.0 --port 3000 >/tmp/opencode-serve.log 2>&1 &";
const WEB_READINESS_COMMAND =
  "bash -lc 'for attempt in $(seq 1 30); do status=$(curl -s -o /dev/null -w \"%{http_code}\" http://127.0.0.1:3000/ || true); if [ \"$status\" = \"200\" ] || [ \"$status\" = \"401\" ]; then exit 0; fi; sleep 1; done; exit 1'";
const WEB_START_TIMEOUT_MS = 10_000;
const WEB_READY_TIMEOUT_MS = 35_000;

export async function startWebMode(handle: SandboxHandle): Promise<ModeLaunchResult> {
  await handle.run(WEB_COMMAND, {
    timeoutMs: WEB_START_TIMEOUT_MS
  });
  await handle.run(WEB_READINESS_COMMAND, {
    timeoutMs: WEB_READY_TIMEOUT_MS
  });

  const host = await handle.getHost(3000);
  const url = ensureHttps(host);

  return {
    mode: "web",
    command: WEB_COMMAND,
    url,
    details: {
      smoke: "opencode-web",
      status: "ready",
      port: 3000
    },
    message: `Started web mode in sandbox ${handle.sandboxId} at ${url}`
  };
}

function ensureHttps(host: string): string {
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
  }

  return `https://${host}`;
}
