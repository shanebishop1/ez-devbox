import { describe, expect, it } from "vitest";
import { resolveTemplateForMode } from "../src/cli/commands.create.template.js";

describe("resolveTemplateForMode", () => {
  it("uses configured non-base template", () => {
    expect(resolveTemplateForMode("custom-template", "web")).toEqual({
      template: "custom-template",
      autoSelected: false,
    });
  });

  it("auto-selects codex for ssh-codex mode", () => {
    expect(resolveTemplateForMode("base", "ssh-codex")).toEqual({
      template: "codex",
      autoSelected: true,
    });
  });

  it("auto-selects opencode for non-codex modes", () => {
    expect(resolveTemplateForMode("", "web")).toEqual({
      template: "opencode",
      autoSelected: true,
    });
    expect(resolveTemplateForMode("", "ssh-claude")).toEqual({
      template: "opencode",
      autoSelected: true,
    });
  });

  it("requires an explicit compatible template for custom mode", () => {
    expect(() => resolveTemplateForMode("base", "ssh-custom")).toThrow("explicit template");
    expect(resolveTemplateForMode("custom-template", "ssh-custom")).toEqual({
      template: "custom-template",
      autoSelected: false,
    });
  });
});
