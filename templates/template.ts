export interface TemplateBuildOptions {
  alias?: string;
  name?: string;
  version?: string;
  baseTemplate?: string;
  codexInstallMarker?: string;
  withGhTooling?: boolean;
  withSshStack?: boolean;
}

export interface TemplateTags {
  alias: string;
  name: string;
  version: string;
}

export interface TemplateFlags {
  withGhTooling: boolean;
  withSshStack: boolean;
}

export interface TemplateDefinition {
  baseTemplate: string;
  codexInstallMarker: string;
  flags: TemplateFlags;
  tags: TemplateTags;
  idPlaceholder: string;
}

const DEFAULTS = {
  alias: "opencode-codex",
  name: "opencode-codex",
  version: "0.0.0",
  baseTemplate: "opencode",
  codexInstallMarker: "codex-install"
} as const;

function normalizeTag(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized || "template";
}

export function buildTemplateDefinition(options: TemplateBuildOptions): TemplateDefinition {
  const alias = normalizeTag(options.alias ?? DEFAULTS.alias);
  const name = normalizeTag(options.name ?? alias ?? DEFAULTS.name);
  const version = normalizeTag(options.version ?? DEFAULTS.version);
  const baseTemplate = normalizeTag(options.baseTemplate ?? DEFAULTS.baseTemplate);
  const codexInstallMarker = normalizeTag(options.codexInstallMarker ?? DEFAULTS.codexInstallMarker);

  return {
    baseTemplate,
    codexInstallMarker,
    flags: {
      withGhTooling: options.withGhTooling ?? false,
      withSshStack: options.withSshStack ?? false
    },
    tags: {
      alias,
      name,
      version
    },
    idPlaceholder: `template-${alias}-${version}`
  };
}

export function renderTemplatePlanLines(definition: TemplateDefinition): string[] {
  const lines = [
    "Template build plan",
    `Base template: ${definition.baseTemplate}`,
    `Step: mark codex install (${definition.codexInstallMarker})`
  ];

  if (definition.flags.withGhTooling) {
    lines.push("Step: include GitHub tooling");
  }

  if (definition.flags.withSshStack) {
    lines.push("Step: include SSH stack");
  }

  lines.push(`Alias placeholder: ${definition.tags.alias}`);
  lines.push(`Name placeholder: ${definition.tags.name}`);
  lines.push(`Version tag: ${definition.tags.version}`);
  lines.push(`Template ID placeholder: ${definition.idPlaceholder}`);

  return lines;
}
