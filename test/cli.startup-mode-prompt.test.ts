import { describe, expect, it, vi } from "vitest";
import { resolvePromptStartupMode } from "../src/cli/startup-mode-prompt.js";

describe("resolvePromptStartupMode", () => {
  it("returns non-prompt modes unchanged", async () => {
    const promptInput = vi.fn().mockResolvedValue("ssh-codex");

    const result = await resolvePromptStartupMode("ssh-shell", {
      isInteractiveTerminal: () => true,
      promptInput
    });

    expect(result).toBe("ssh-shell");
    expect(promptInput).not.toHaveBeenCalled();
  });

  it("falls back to ssh-opencode when terminal is not interactive", async () => {
    const promptInput = vi.fn().mockResolvedValue("2");

    const result = await resolvePromptStartupMode("prompt", {
      isInteractiveTerminal: () => false,
      promptInput
    });

    expect(result).toBe("ssh-opencode");
    expect(promptInput).not.toHaveBeenCalled();
  });

  it("accepts numeric selections with deterministic mapping", async () => {
    await expectResolvedMode("1", "ssh-opencode");
    await expectResolvedMode("2", "ssh-codex");
    await expectResolvedMode("3", "web");
    await expectResolvedMode("4", "ssh-shell");
  });

  it("accepts textual selections", async () => {
    await expectResolvedMode("ssh-opencode", "ssh-opencode");
    await expectResolvedMode("SSH-CODEX", "ssh-codex");
    await expectResolvedMode(" web ", "web");
    await expectResolvedMode("ssh-shell", "ssh-shell");
  });

  it("falls back to ssh-opencode on empty or invalid input", async () => {
    await expectResolvedMode("", "ssh-opencode");
    await expectResolvedMode(" ", "ssh-opencode");
    await expectResolvedMode("5", "ssh-opencode");
    await expectResolvedMode("not-a-mode", "ssh-opencode");
  });

  it("shows numbered choices in the prompt text", async () => {
    const promptInput = vi.fn().mockResolvedValue("1");

    await resolvePromptStartupMode("prompt", {
      isInteractiveTerminal: () => true,
      promptInput
    });

    expect(promptInput).toHaveBeenCalledWith(
      [
        "ez-devbox",
        "Select startup mode:",
        "1) ssh-opencode",
        "2) ssh-codex",
        "3) web",
        "4) ssh-shell",
        "Enter choice [1/ssh-opencode]: "
      ].join("\n")
    );
  });
});

async function expectResolvedMode(input: string, expected: "ssh-opencode" | "ssh-codex" | "web" | "ssh-shell"): Promise<void> {
  const result = await resolvePromptStartupMode("prompt", {
    isInteractiveTerminal: () => true,
    promptInput: vi.fn().mockResolvedValue(input)
  });

  expect(result).toBe(expected);
}
