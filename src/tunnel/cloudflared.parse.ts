const URL_REGEX = /https:\/\/[a-z0-9.-]+/gi;

export function attachLogStream(
  stream: NodeJS.ReadableStream | null,
  recentLogs: string[],
  onUrl: (url: string) => void
): void {
  if (!stream) {
    return;
  }

  stream.setEncoding("utf8");
  let buffer = "";

  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      pushRecentLog(recentLogs, line);
      const url = extractTunnelUrl(line);
      if (url) {
        onUrl(url);
      }
    }
  });
}

export function formatRecentLogs(recentLogs: string[]): string {
  if (recentLogs.length === 0) {
    return "";
  }

  return ` Recent cloudflared logs: ${recentLogs.slice(-5).join(" | ")}`;
}

function pushRecentLog(recentLogs: string[], line: string): void {
  const normalized = line.trim();
  if (normalized === "") {
    return;
  }

  recentLogs.push(normalized);
  if (recentLogs.length > 20) {
    recentLogs.shift();
  }
}

function extractTunnelUrl(value: string): string | null {
  const matches = value.match(URL_REGEX);
  if (!matches) {
    return null;
  }

  for (const candidate of matches) {
    if (candidate.includes("localhost") || candidate.includes("127.0.0.1")) {
      continue;
    }

    try {
      const hostname = new URL(candidate).hostname.toLowerCase();
      if (hostname === "trycloudflare.com" || hostname.endsWith(".trycloudflare.com")) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}
