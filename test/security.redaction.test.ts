import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "../src/security/redaction.js";

describe("redactSensitiveText", () => {
  it("redacts assignment-style secrets for known keys and token-like suffixes", () => {
    const input = "GH_TOKEN=abc GITHUB_TOKEN='def' OPENAI_API_KEY=\"ghi\" E2B_API_KEY=xyz FIRECRAWL_API_KEY:secret SERVICE_TOKEN=token";
    const redacted = redactSensitiveText(input);

    expect(redacted).toContain("GH_TOKEN=[REDACTED]");
    expect(redacted).toContain("GITHUB_TOKEN=[REDACTED]");
    expect(redacted).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(redacted).toContain("E2B_API_KEY=[REDACTED]");
    expect(redacted).toContain("FIRECRAWL_API_KEY:[REDACTED]");
    expect(redacted).toContain("SERVICE_TOKEN=[REDACTED]");
  });

  it("redacts URL credentials", () => {
    const input = "https://user:secret@example.com/path";
    expect(redactSensitiveText(input)).toBe("https://user:[REDACTED]@example.com/path");
  });

  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer abc.def.ghi";
    expect(redactSensitiveText(input)).toBe("Authorization: Bearer [REDACTED]");
  });

  it("redacts basic auth tokens", () => {
    const input = "Authorization: Basic dXNlcjpwYXNz";
    expect(redactSensitiveText(input)).toBe("Authorization: Basic [REDACTED]");
  });

  it("redacts sensitive query params", () => {
    const input = "https://example.com/cb?token=abc&api_key=123&x=1";
    expect(redactSensitiveText(input)).toBe("https://example.com/cb?token=[REDACTED]&api_key=[REDACTED]&x=1");
  });

  it("does not redact non-sensitive fields", () => {
    const input = "PROJECT_NAME=ez-devbox MODE=web";
    expect(redactSensitiveText(input)).toBe(input);
  });
});
