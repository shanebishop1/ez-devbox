const URL_CREDENTIALS_REGEX = /(https?:\/\/[^\s:/@]+:)([^@\s/]+)(@)/gi;
const SENSITIVE_ASSIGNMENT_REGEX =
  /\b(GH_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENCODE_SERVER_PASSWORD)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_TOKEN_REGEX = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(URL_CREDENTIALS_REGEX, "$1[REDACTED]$3")
    .replace(SENSITIVE_ASSIGNMENT_REGEX, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(BEARER_TOKEN_REGEX, "Bearer [REDACTED]");
}
