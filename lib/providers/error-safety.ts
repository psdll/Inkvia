const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/gi;
const AUTH_HEADER_PATTERN = /\b(?:proxy-authorization|authorization)\s*[:=]\s*(?:(?:Bearer|Basic|Key)\s+)?[^\s,;}\]]+/gi;
const AUTH_VALUE_PATTERN = /\b(?:Bearer|Basic|Key)\s+[A-Za-z0-9._~+/=-]+/gi;
const NAMED_SECRET_PATTERN = /\b((?:api[-_\s]?key|token|secret|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/g;
const MAX_PROVIDER_ERROR_LENGTH = 600;

function sensitiveVariants(values: readonly string[]) {
  const variants = new Set<string>();
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    variants.add(value);
    const credential = /^(?:Bearer|Basic|Key)\s+(.+)$/i.exec(value)?.[1]?.trim();
    if (credential) variants.add(credential);
    if (/^Basic\s+/i.test(value) && credential) {
      try {
        const decoded = atob(credential);
        if (decoded) variants.add(decoded);
        for (const part of decoded.split(":")) if (part.length >= 3) variants.add(part);
      } catch {}
    }
    try {
      const parsed = new URL(value);
      variants.add(parsed.href);
      if (parsed.username) variants.add(decodeURIComponent(parsed.username));
      if (parsed.password) variants.add(decodeURIComponent(parsed.password));
    } catch {
      // Most sensitive values are tokens rather than URLs.
    }
  }
  return Array.from(variants).sort((left, right) => right.length - left.length);
}

function replaceExactSensitive(value: string, sensitiveValues: readonly string[]) {
  let text = value;
  for (const sensitive of sensitiveVariants(sensitiveValues)) {
    const isLocation = /^https?:\/\//i.test(sensitive);
    if (isLocation) {
      const escaped = sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(
        new RegExp(`${escaped}(?![A-Za-z0-9._~:/?#[\\]@!$&'()*+,;=%-])`, "g"),
        "[REDACTED]",
      );
    } else {
      text = text.split(sensitive).join("[REDACTED]");
    }
    try {
      const encoded = encodeURIComponent(sensitive);
      if (encoded !== sensitive) {
        text = isLocation
          ? text.replace(new RegExp(`${encoded}(?![A-Za-z0-9._~%/-])`, "g"), "[REDACTED]")
          : text.split(encoded).join("[REDACTED]");
      }
    } catch {}
  }
  return text;
}

function normalizedFieldName(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isErrorField(value: string) {
  return /^(?:error|errors|errormessage|errormsg|message|msg|reason|detail|failure|failmessage|failmsg|failreason|failedmessage|failedmsg|failedreason|failurereason)$/.test(normalizedFieldName(value));
}

function isSecretField(value: string) {
  return /^(?:authorization|proxyauthorization|apikey|token|secret|password)$/.test(normalizedFieldName(value));
}

export function providerErrorSensitiveValues(
  decision: { mode?: string; proxyUri?: string; proxyToken?: string } | null | undefined,
  ...values: Array<string | null | undefined>
): string[] {
  return [
    ...values,
    decision?.mode === "proxy" ? decision.proxyUri : undefined,
    decision?.mode === "proxy" ? decision.proxyToken : undefined,
  ].map((item) => String(item || "").trim()).filter(Boolean);
}

/**
 * Sanitizes untrusted upstream error text before it enters Error objects,
 * logs, persisted task errors, or API responses.
 */
export function sanitizeProviderErrorText(
  value: unknown,
  sensitiveValues: readonly string[] = [],
  fallback = "上游请求失败",
): string {
  let text = String(value ?? "");
  text = replaceExactSensitive(text, sensitiveValues);

  text = text
    .replace(URL_PATTERN, "[REDACTED_URL]")
    .replace(AUTH_HEADER_PATTERN, "Authorization: [REDACTED]")
    .replace(AUTH_VALUE_PATTERN, "Bearer [REDACTED]")
    .replace(NAMED_SECRET_PATTERN, "$1[REDACTED]")
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) text = fallback;
  if (text.length > MAX_PROVIDER_ERROR_LENGTH) {
    text = `${text.slice(0, MAX_PROVIDER_ERROR_LENGTH)}…`;
  }
  return text;
}

/** Sanitizes only error-like fields while leaving successful result/media URLs intact. */
export function sanitizeProviderErrorFields<T>(
  value: T,
  sensitiveValues: readonly string[] = [],
): T {
  const seen = new WeakSet<object>();
  const visit = (current: unknown, insideError: boolean, depth: number): unknown => {
    if (typeof current === "string") {
      const exactSafe = replaceExactSensitive(current, sensitiveValues);
      return insideError
        ? sanitizeProviderErrorText(exactSafe, sensitiveValues, "上游请求失败")
        : exactSafe;
    }
    if (current === null || typeof current !== "object") return current;
    if (depth > 12) return insideError ? "[REDACTED]" : null;
    if (seen.has(current)) return insideError ? "[REDACTED]" : null;
    seen.add(current);
    if (ArrayBuffer.isView(current) || current instanceof ArrayBuffer) {
      return insideError ? "[REDACTED_BINARY]" : current;
    }
    if (Array.isArray(current)) {
      return current.map((item) => visit(item, insideError, depth + 1));
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      const safeKey = sanitizeProviderErrorText(key, sensitiveValues, "[REDACTED_FIELD]");
      if (isSecretField(key)) {
        output[safeKey] = "[REDACTED]";
        continue;
      }
      const childIsError = insideError || isErrorField(key);
      output[safeKey] = visit(item, childIsError, depth + 1);
    }
    return output;
  };
  return visit(value, false, 0) as T;
}
