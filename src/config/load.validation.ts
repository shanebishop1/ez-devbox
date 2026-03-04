import type { ResolvedLauncherConfig } from "./schema.js";

export function assertRequiredE2BApiKey(mergedEnv: Record<string, string | undefined>): void {
  const e2bApiKey = mergedEnv.E2B_API_KEY;
  if (typeof e2bApiKey !== "string" || e2bApiKey.trim() === "") {
    throw new Error("Invalid env.E2B_API_KEY: required value is missing. Set E2B_API_KEY in process env or .env.");
  }
}

export function validateResolvedLauncherConfig(resolved: ResolvedLauncherConfig): void {
  if (resolved.sandbox.timeout_ms <= 0 || !Number.isInteger(resolved.sandbox.timeout_ms)) {
    throw new Error("Invalid sandbox.timeout_ms: expected a positive integer in milliseconds.");
  }

  if (resolved.project.setup_retries < 0 || !Number.isInteger(resolved.project.setup_retries)) {
    throw new Error("Invalid project.setup_retries: expected an integer greater than or equal to 0.");
  }

  if (resolved.project.setup_concurrency < 1 || !Number.isInteger(resolved.project.setup_concurrency)) {
    throw new Error("Invalid project.setup_concurrency: expected an integer greater than or equal to 1.");
  }

  if (resolved.project.working_dir !== "auto" && resolved.project.working_dir.trim() === "") {
    throw new Error("Invalid project.working_dir: expected 'auto' or a non-empty path string.");
  }

  if (resolved.project.active === "name") {
    const activeName = resolved.project.active_name?.trim();
    if (!activeName) {
      throw new Error("Invalid project.active_name: required when project.active is 'name'.");
    }
  }

  if (resolved.project.active === "index") {
    const activeIndex = resolved.project.active_index;
    if (!Number.isInteger(activeIndex)) {
      throw new Error("Invalid project.active_index: required integer when project.active is 'index'.");
    }
    const resolvedActiveIndex = activeIndex as number;
    if (resolvedActiveIndex < 0 || resolvedActiveIndex >= resolved.project.repos.length) {
      throw new Error(
        `Invalid project.active_index: index ${resolvedActiveIndex.toString()} is out of range for ${resolved.project.repos.length} repos.`,
      );
    }
  }

  if (resolved.gh.config_dir.trim() === "") {
    throw new Error("Invalid gh.config_dir: expected a non-empty path string.");
  }

  const targetPorts: number[] = [];
  for (const [portKey, upstreamUrl] of Object.entries(resolved.tunnel.targets ?? {})) {
    const port = Number.parseInt(portKey, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== portKey) {
      throw new Error(`Invalid tunnel.targets.${portKey}: key must be a stringified integer between 1 and 65535.`);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(upstreamUrl);
    } catch {
      throw new Error(`Invalid tunnel.targets.${portKey}: expected a valid http(s) URL string.`);
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Invalid tunnel.targets.${portKey}: expected an http(s) URL.`);
    }

    if (parsedUrl.username !== "" || parsedUrl.password !== "") {
      throw new Error(`Invalid tunnel.targets.${portKey}: URL credentials are not allowed.`);
    }

    if (parsedUrl.search !== "" || parsedUrl.hash !== "" || parsedUrl.pathname !== "/") {
      throw new Error(`Invalid tunnel.targets.${portKey}: query/fragment/path are not allowed.`);
    }

    targetPorts.push(port);
  }

  if (targetPorts.length > 0) {
    resolved.tunnel.ports = targetPorts;
  }

  const seenTunnelPorts = new Set<number>();
  for (const [index, port] of resolved.tunnel.ports.entries()) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid tunnel.ports[${index}]: expected an integer between 1 and 65535.`);
    }

    if (seenTunnelPorts.has(port)) {
      throw new Error(`Invalid tunnel.ports[${index}]: duplicate port '${port}' is not allowed.`);
    }

    seenTunnelPorts.add(port);
  }
}
