const URL_CREDENTIALS_REGEX = /(https?:\/\/[^\s:/@]+:)([^@\s/]+)(@)/gi;
const SENSITIVE_ASSIGNMENT_REGEX =
  /\b(?:GH_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENCODE_SERVER_PASSWORD|E2B_API_KEY|FIRECRAWL_API_KEY|[A-Z][A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD|PRIVATE_KEY))\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_TOKEN_REGEX = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_TOKEN_REGEX = /\bBasic\s+[A-Za-z0-9+/=]+/gi;
const SENSITIVE_QUERY_PARAM_REGEX = /([?&](?:token|access_token|api_key|apikey|key|secret|password)=)([^&#\s]+)/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(URL_CREDENTIALS_REGEX, "$1[REDACTED]$3")
    .replace(SENSITIVE_ASSIGNMENT_REGEX, (match) => {
      const delimiterIndex = match.indexOf("=");
      if (delimiterIndex >= 0) {
        return `${match.slice(0, delimiterIndex)}=[REDACTED]`;
      }

      const colonIndex = match.indexOf(":");
      if (colonIndex >= 0) {
        return `${match.slice(0, colonIndex)}:[REDACTED]`;
      }

      return "[REDACTED]";
    })
    .replace(BEARER_TOKEN_REGEX, "Bearer [REDACTED]")
    .replace(BASIC_TOKEN_REGEX, "Basic [REDACTED]")
    .replace(SENSITIVE_QUERY_PARAM_REGEX, "$1[REDACTED]");
}
