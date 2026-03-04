import type { ConcreteStartupMode } from "../modes/index.js";

export function resolveTemplateForMode(
  configuredTemplate: string,
  mode: ConcreteStartupMode,
): { template: string; autoSelected: boolean } {
  const normalized = configuredTemplate.trim();
  if (normalized !== "" && normalized !== "base") {
    return {
      template: configuredTemplate,
      autoSelected: false,
    };
  }

  if (mode === "ssh-codex") {
    return {
      template: "codex",
      autoSelected: true,
    };
  }

  return {
    template: "opencode",
    autoSelected: true,
  };
}
