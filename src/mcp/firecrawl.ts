export function assertRemoteFirecrawlUrl(url: string): void {
  if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) {
    throw new Error("FIRECRAWL_API_URL must be remotely reachable for E2B sandboxes");
  }
}
