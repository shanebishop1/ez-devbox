import { setTimeout as sleep } from "node:timers/promises";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import {
  APT_LOCK_RETRY_ATTEMPTS,
  APT_LOCK_RETRY_DELAY_MS,
  SSH_SETUP_TIMEOUT_MS,
  SSH_SHORT_TIMEOUT_MS,
} from "./ssh-bridge.constants.js";

export async function ensureSshBridgeDependencies(handle: Pick<SandboxHandle, "run">): Promise<void> {
  if (await hasSshBridgeDependencies(handle)) {
    return;
  }

  logger.verbose("SSH bridge: missing dependencies; installing openssh-server, websockify, and tmux.");
  const installCommand = "bash -lc 'sudo apt-get update && sudo apt-get install -y openssh-server websockify tmux'";

  for (let attempt = 1; attempt <= APT_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await handle.run(installCommand, { timeoutMs: SSH_SETUP_TIMEOUT_MS });
      if (await hasSshBridgeDependencies(handle)) {
        return;
      }
      throw new Error("SSH bridge dependencies remain unavailable after apt-get install.");
    } catch (error) {
      if (!isDpkgLockError(error) || attempt === APT_LOCK_RETRY_ATTEMPTS) {
        throw error;
      }

      logger.verbose(
        `SSH bridge: apt/dpkg lock detected while installing dependencies (attempt ${attempt}/${APT_LOCK_RETRY_ATTEMPTS}); retrying in ${APT_LOCK_RETRY_DELAY_MS}ms.`,
      );
      await sleep(APT_LOCK_RETRY_DELAY_MS);
    }
  }
}

async function hasSshBridgeDependencies(handle: Pick<SandboxHandle, "run">): Promise<boolean> {
  const result = await handle.run(
    "bash -lc 'if [ -x /usr/sbin/sshd ] && command -v websockify >/dev/null 2>&1 && command -v ssh-keygen >/dev/null 2>&1 && command -v tmux >/dev/null 2>&1; then printf READY; else printf MISSING; fi'",
    { timeoutMs: SSH_SHORT_TIMEOUT_MS },
  );

  return result.stdout.trim() === "READY";
}

function isDpkgLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Could not get lock /var/lib/dpkg/lock-frontend") ||
    message.includes("Unable to acquire the dpkg frontend lock") ||
    message.includes("Could not get lock /var/lib/apt/lists/lock") ||
    message.includes("Unable to lock directory /var/lib/apt/lists")
  );
}
