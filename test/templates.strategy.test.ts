import { describe, expect, it } from "vitest";
import { buildTemplateDefinition, renderTemplatePlanLines } from "../templates/template.js";

describe("template strategy scaffolding", () => {
  it("builds deterministic defaults", () => {
    const definition = buildTemplateDefinition({});

    expect(definition.baseTemplate).toBe("opencode");
    expect(definition.codexInstallMarker).toBe("codex-install");
    expect(definition.flags.withGhTooling).toBe(false);
    expect(definition.flags.withSshStack).toBe(false);
    expect(definition.tags.alias).toBe("opencode-codex");
    expect(definition.tags.name).toBe("opencode-codex");
    expect(definition.tags.version).toBe("0.0.0");
    expect(definition.idPlaceholder).toBe("template-opencode-codex-0.0.0");
  });

  it("includes optional flags in definition", () => {
    const definition = buildTemplateDefinition({
      alias: "my-opencode-codex",
      withGhTooling: true,
      withSshStack: true,
      version: "1.2.3"
    });

    expect(definition.flags.withGhTooling).toBe(true);
    expect(definition.flags.withSshStack).toBe(true);
    expect(definition.tags.alias).toBe("my-opencode-codex");
    expect(definition.idPlaceholder).toBe("template-my-opencode-codex-1.2.3");
  });

  it("renders plan with expected steps", () => {
    const definition = buildTemplateDefinition({
      alias: "my-opencode-codex",
      withGhTooling: true,
      withSshStack: true
    });

    const lines = renderTemplatePlanLines(definition);
    const output = lines.join("\n");

    expect(output).toContain("Base template: opencode");
    expect(output).toContain("Step: mark codex install (codex-install)");
    expect(output).toContain("Step: include GitHub tooling");
    expect(output).toContain("Step: include SSH stack");
    expect(output).toContain("Alias placeholder: my-opencode-codex");
  });
});
