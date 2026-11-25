import { createHash } from "node:crypto";

const secretKey = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client_secret|api[-_]?key|access[-_]?token|refresh[-_]?token|token|signature|credential|x[-_](?:api[-_]?key|auth[-_]?token)|x-(?:amz|oss|tos)-.+|ossaccesskeyid)$/i;
const binaryKey = /^(?:b64_json|base64|bytes)$/i;
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const omitted = (reason: string, size?: number) => ({ __traceOmitted: true, reason, ...(size === undefined ? {} : { size }) });

function redactText(value: string, secrets: readonly string[]): string {
  let text = value;
  for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join("[已脱敏]");
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.:-]+/gi, "$1 [已脱敏]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, "[已脱敏]")
    .replace(/((?:api[-_]?key|access[-_]?token|password|secret|signature|credential)\s*[=:]\s*["']?)[^\s&"'<>]+/gi, "$1[已脱敏]");
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
    try {
      const url = new URL(raw);
      if (url.username || url.password) { url.username = "redacted"; url.password = ""; }
      for (const key of [...url.searchParams.keys()]) if (secretKey.test(key)) url.searchParams.set(key, "[已脱敏]");
      return url.toString();
    } catch { return "[无效 URL 已隐藏]"; }
  });
}

/** Used before persistence, including nested JSON strings and media bodies. Never changes the request itself. */
export function sanitizeDebugValue(value: unknown, secrets: readonly string[] = []): unknown {
  const seen = new WeakSet<object>();
  let entries = 0;
  function visit(input: unknown, key = "", depth = 0): unknown {
    if (secretKey.test(key)) return "[已脱敏]";
    if (++entries > 30_000 || depth > 30) return omitted("嵌套或字段数量超过记录上限");
    if (input == null || typeof input === "boolean" || typeof input === "number") return input;
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "string") {
      const data = /^data:([^;,]*)(?:;[^,]*)?;base64,([\s\S]*)$/.exec(input);
      if (data || (binaryKey.test(key) && input.length > 128) || (key === "data" && input.length > 512 && /^[A-Za-z0-9+/=\r\n]+$/.test(input))) {
        const bytes = Buffer.from(data ? data[2] : input, "base64");
        return { __traceBinary: true, mimeType: data?.[1] || "application/octet-stream", bytes: bytes.length, sha256: digest(bytes), representation: "二进制已折叠，未保存文件副本" };
      }
      if (input.length > 600_000) return { ...omitted("文本超过 600000 字符", input.length), preview: redactText(input.slice(0, 20_000), secrets) };
      if (/^\s*[\[{]/.test(input)) {
        try { return JSON.stringify(visit(JSON.parse(input), "", depth + 1)); } catch { /* Ordinary prompt text. */ }
      }
      return redactText(input, secrets);
    }
    if (typeof input !== "object") return String(input);
    if (input instanceof Date) return input.toISOString();
    if (input instanceof URL) return redactText(input.toString(), secrets);
    if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
      const bytes = Buffer.from(input);
      return { __traceBinary: true, bytes: bytes.length, sha256: digest(bytes) };
    }
    if (typeof Blob !== "undefined" && input instanceof Blob) return { __traceBinary: true, bytes: input.size, mimeType: input.type, name: "name" in input ? String(input.name) : undefined };
    if (seen.has(input)) return omitted("循环引用");
    seen.add(input);
    if (Array.isArray(input)) return input.map(item => visit(item, "", depth + 1));
    if (typeof (input as { entries?: unknown }).entries === "function" && /Headers|FormData|URLSearchParams/.test(input.constructor?.name || "")) {
      const pairs = [...(input as Map<string, unknown>).entries()];
      return pairs.map(([name, item]) => ({ name, value: visit(item, name, depth + 1) }));
    }
    return Object.fromEntries(Object.entries(input).map(([name, item]) => [name, visit(item, name, depth + 1)]));
  }
  const sanitized = visit(value);
  const json = JSON.stringify(sanitized);
  return json && Buffer.byteLength(json) > 2_000_000 ? omitted("单条详情超过 2 MB，记录不完整", Buffer.byteLength(json)) : sanitized;
}

export function debugSecretsFromHeaders(headers: unknown): string[] {
  if (!headers) return [];
  const items = typeof (headers as { entries?: unknown }).entries === "function"
    ? [...(headers as Map<string, unknown>).entries()]
    : Object.entries(headers);
  return items.filter(([key]) => secretKey.test(key)).flatMap(([, value]) => {
    const text = String(value ?? "");
    return [text, text.replace(/^(?:Bearer|Basic)\s+/i, "")].filter(item => item.length >= 4);
  });
}
