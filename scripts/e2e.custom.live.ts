import { config as loadDotEnv } from "dotenv";
import { loadConfig } from "../src/config/load.js";
import { connectSandbox, createSandbox, killSandbox, listSandboxes } from "../src/e2b/lifecycle.js";
import { launchMode } from "../src/modes/index.js";
import { quoteShellArg } from "../src/utils/shell.js";

const OUTPUT_PATH = "/tmp/ez-devbox-custom-live-output.txt";
const AGENT_PATH = "/tmp/ez-devbox-custom-live-agent";
const SANDBOX_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 120_000;

async function main(): Promise<void> {
  loadDotEnv();
  if (!process.env.E2B_API_KEY) {
    throw new Error("Missing E2B_API_KEY in environment.");
  }

  const baseConfig = await loadConfig();
  const config = {
    ...baseConfig,
    sandbox: {
      ...baseConfig.sandbox,
      template: "opencode",
      reuse: false,
      delete_on_exit: true,
      timeout_ms: SANDBOX_TIMEOUT_MS,
    },
  };
  const outputPath = quoteShellArg(OUTPUT_PATH);
  const agentPath = quoteShellArg(AGENT_PATH);
  const customAgent = {
    command: [AGENT_PATH],
    check_command: `test -x ${agentPath}`,
    install_command: [
      `printf '%s\n' '#!/bin/sh' 'printf "ARGV:%s\\n" "$*" >> ${outputPath}' 'while IFS= read -r line; do printf "STDIN:%s\\n" "$line" >> ${outputPath}; done' > ${agentPath}`,
      `chmod 700 ${agentPath}`,
    ].join("; "),
    initial_prompt_command: [AGENT_PATH, "--prompt", "{prompt}"],
    follow_up: "tmux" as const,
    files: [],
  };

  let sandboxId: string | undefined;
  let runError: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    const sandbox = await createSandbox(config, {
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      metadata: { "launcher.live": "ssh-custom" },
    });
    sandboxId = sandbox.sandboxId;
    console.log(`[e2e:custom:live] CREATED owned sandbox ${sandboxId}`);

    await sandbox.run(`rm -f -- ${outputPath} ${agentPath}`, { timeoutMs: 10_000 });
    await launchMode(sandbox, "ssh-custom", {
      customAgent,
      detach: true,
      prompt: { kind: "initial", text: "initial $(touch /tmp/ez-devbox-custom-live-injected)" },
    });
    const reconnected = await connectSandbox(sandboxId, config, { requestTimeoutMs: REQUEST_TIMEOUT_MS });
    await launchMode(reconnected, "ssh-custom", {
      customAgent,
      detach: true,
      prompt: { kind: "follow-up", text: "follow-up $(touch /tmp/ez-devbox-custom-live-injected)" },
    });

    const output = await reconnected.run(`cat ${outputPath}`, { timeoutMs: 10_000 });
    if (!output.stdout.includes("initial $(touch /tmp/ez-devbox-custom-live-injected)")) {
      throw new Error("Initial prompt was not delivered as a literal argument.");
    }
    if (!output.stdout.includes("STDIN:follow-up $(touch /tmp/ez-devbox-custom-live-injected)")) {
      throw new Error("Follow-up prompt was not delivered through tmux stdin.");
    }

    const injectionCheck = await reconnected.run(`test ! -e ${quoteShellArg("/tmp/ez-devbox-custom-live-injected")}`, {
      timeoutMs: 10_000,
    });
    if (injectionCheck.exitCode !== 0) {
      throw new Error("Prompt text executed as shell syntax in the sandbox.");
    }

    console.log(`[e2e:custom:live] PASS ssh-custom sandbox ${sandboxId}`);
  } catch (error) {
    runError = error;
  } finally {
    if (sandboxId !== undefined) {
      try {
        const killed = await killSandbox(sandboxId, { requestTimeoutMs: REQUEST_TIMEOUT_MS });
        if (!killed) {
          cleanupErrors.push(new Error(`Failed to clean up sandbox ${sandboxId}.`));
        } else {
          console.log(`[e2e:custom:live] PASS cleanup ${sandboxId}`);
        }
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        const remaining = await listSandboxes({ requestTimeoutMs: REQUEST_TIMEOUT_MS });
        if (remaining.some((sandbox) => sandbox.sandboxId === sandboxId)) {
          cleanupErrors.push(new Error(`Owned sandbox ${sandboxId} is still present after cleanup.`));
        } else {
          console.log(`[e2e:custom:live] PASS cleanup verification ${sandboxId} absent`);
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  const errors = runError === undefined ? cleanupErrors : [runError, ...cleanupErrors];
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Custom live smoke and/or cleanup failed.");
  }
}

await main();
