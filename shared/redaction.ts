/** Secret / PII redaction for logs and telemetry. */

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "typesafe_apikey", re: /\bapikey_[A-Za-z0-9_]{16,}\b/gi },
  { name: "api_key", re: /\b(?:sk|pk|rk|key)[-_][A-Za-z0-9]{16,}\b/gi },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  { name: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "openai", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "typesafe_env", re: /\bTYPESAFE_API_KEY\s*=\s*\S+/gi },
  { name: "cursor_env", re: /\bCURSOR_API_KEY\s*=\s*\S+/gi },
  { name: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, `[REDACTED:${name}]`);
  }
  return out;
}

export function taskDigest(task: string, logPromptContent: boolean): string {
  const cleaned = redactSecrets(task).trim();
  if (logPromptContent) {
    return cleaned.length > 500 ? `${cleaned.slice(0, 500)}…` : cleaned;
  }
  let hash = 0;
  for (let i = 0; i < cleaned.length; i++) {
    hash = (hash * 31 + cleaned.charCodeAt(i)) >>> 0;
  }
  return `len=${cleaned.length};fp=${hash.toString(16)}`;
}

export function containsSecret(input: string): boolean {
  return SECRET_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(input);
  });
}
