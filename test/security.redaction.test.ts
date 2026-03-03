import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "../src/security/redaction.js";

describe("redactSensitiveText", () => {
  it("redacts token assignments", () => {
    const input = "GH_TOKEN=abc GITHUB_TOKEN='def' OPENAI_API_KEY=\"ghi\"";
    const redacted = redactSensitiveText(input);

    expect(redacted).toContain("GH_TOKEN=[REDACTED]");
    expect(redacted).toContain("GITHUB_TOKEN=[REDACTED]");
    expect(redacted).toContain("OPENAI_API_KEY=[REDACTED]");
  });

  it("redacts URL credentials", () => {
    const input = "https://user:secret@example.com/path";
    expect(redactSensitiveText(input)).toBe("https://user:[REDACTED]@example.com/path");
  });

  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer abc.def.ghi";
    expect(redactSensitiveText(input)).toBe("Authorization: Bearer [REDACTED]");
  });
});
