import { describe, expect, it, vi } from "vitest";
import { resolvePromptStartupMode } from "../src/cli/startup-mode-prompt.js";

describe("resolvePromptStartupMode", () => {
  it("returns non-prompt modes unchanged", async () => {
    const promptInput = vi.fn().mockResolvedValue("ssh-codex");

    const result = await resolvePromptStartupMode("ssh-shell", {
      isInteractiveTerminal: () => true,
      promptInput,
    });

    expect(result).toBe("ssh-shell");
    expect(promptInput).not.toHaveBeenCalled();
  });

  it("falls back to ssh-opencode when terminal is not interactive", async () => {
    const promptInput = vi.fn().mockResolvedValue("2");

    const result = await resolvePromptStartupMode("prompt", {
      isInteractiveTerminal: () => false,
      promptInput,
    });

    expect(result).toBe("ssh-opencode");
    expect(promptInput).not.toHaveBeenCalled();
  });

  it("accepts numeric selections with deterministic mapping", async () => {
    await expectResolvedMode("1", "ssh-opencode");
    await expectResolvedMode("2", "ssh-claude");
    await expectResolvedMode("3", "ssh-codex");
    await expectResolvedMode("4", "web");
    await expectResolvedMode("5", "ssh-shell");
  });

  it("accepts textual selections", async () => {
    await expectResolvedMode("ssh-opencode", "ssh-opencode");
    await expectResolvedMode("SSH-CODEX", "ssh-codex");
    await expectResolvedMode("web-opencode", "web");
    await expectResolvedMode(" web ", "web");
    await expectResolvedMode("ssh-shell", "ssh-shell");
    await expectResolvedMode("ssh-claude", "ssh-claude");
  });

  it("reprompts in interactive mode until a valid selection is provided", async () => {
    const promptInput = vi.fn().mockResolvedValueOnce("0").mockResolvedValueOnce("ssh-codex");

    const result = await resolvePromptStartupMode("prompt", {
      isInteractiveTerminal: () => true,
      promptInput,
    });

    expect(result).toBe("ssh-codex");
    expect(promptInput).toHaveBeenCalledTimes(2);
  });

  it("throws actionable error after repeated invalid interactive input", async () => {
    const promptInput = vi
      .fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(" ")
      .mockResolvedValueOnce("not-a-mode");

    await expect(
      resolvePromptStartupMode("prompt", {
        isInteractiveTerminal: () => true,
        promptInput,
      }),
    ).rejects.toThrow("Invalid startup mode selection after 3 attempts");
  });

  it("shows numbered choices in the prompt text", async () => {
    const promptInput = vi.fn().mockResolvedValue("1");

    await resolvePromptStartupMode("prompt", {
      isInteractiveTerminal: () => true,
      promptInput,
    });

    expect(promptInput).toHaveBeenCalledWith(
      [
        "\u001b[2J\u001b[H+-----------+",
        "| ez-devbox |",
        "+-----------+",
        "",
        "Select startup mode:",
        "--------------------",
        "1) ssh-opencode",
        "2) ssh-claude",
        "3) ssh-codex",
        "4) web-opencode",
        "5) ssh-shell",
        "",
        "Enter choice: ",
      ].join("\n"),
    );
  });

  it("renders preface lines between title and mode selection", async () => {
    const promptInput = vi.fn().mockResolvedValue("1");

    await resolvePromptStartupMode(
      "prompt",
      {
        isInteractiveTerminal: () => true,
        promptInput,
      },
      {
        prefaceLines: ["[INFO] Using launcher config: /tmp/launcher.config.toml"],
      },
    );

    expect(promptInput).toHaveBeenCalledWith(
      [
        "\u001b[2J\u001b[H+-----------+",
        "| ez-devbox |",
        "+-----------+",
        "",
        "[INFO] Using launcher config: /tmp/launcher.config.toml",
        "",
        "Select startup mode:",
        "--------------------",
        "1) ssh-opencode",
        "2) ssh-claude",
        "3) ssh-codex",
        "4) web-opencode",
        "5) ssh-shell",
        "",
        "Enter choice: ",
      ].join("\n"),
    );
  });
});

async function expectResolvedMode(
  input: string,
  expected: "ssh-opencode" | "ssh-codex" | "web" | "ssh-shell" | "ssh-claude",
): Promise<void> {
  const result = await resolvePromptStartupMode("prompt", {
    isInteractiveTerminal: () => true,
    promptInput: vi.fn().mockResolvedValue(input),
  });

  expect(result).toBe(expected);
}
