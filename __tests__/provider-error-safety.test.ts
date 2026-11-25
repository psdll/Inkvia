import { describe, expect, it } from "vitest";

import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";

describe("provider response error safety", () => {
  it("redacts request credentials, full URLs, authorization headers, and control characters", () => {
    const apiKey = "provider-super-secret";
    const endpoint = "https://private-provider.example/v1/generate";
    const value = `Proxy-Authorization: Basic abc123 Authorization: Bearer ${apiKey} endpoint=${endpoint}?key=${apiKey}\n\u0000`;

    const safe = sanitizeProviderErrorText(value, [apiKey, endpoint], "上游请求失败");

    expect(safe).toContain("[REDACTED]");
    expect(safe).not.toContain(apiKey);
    expect(safe).not.toContain("private-provider.example");
    expect(safe).not.toContain("abc123");
    expect(safe).not.toContain("\u0000");
  });

  it("keeps useful classification words while bounding the output", () => {
    const safe = sanitizeProviderErrorText(`model not supported ${"x".repeat(2000)}`, [], "上游请求失败");

    expect(safe).toContain("model not supported");
    expect(safe.length).toBeLessThanOrEqual(601);
  });

  it("sanitizes nested error fields without removing successful media URLs", () => {
    const payload = sanitizeProviderErrorFields({
      result: { url: "https://cdn.example.test/result.png" },
      data: {
        error: {
          message: "provider-secret https://private-provider.example/failure",
          apiKey: "provider-secret",
        },
        error_message: "provider-secret https://private-provider.example/error_message",
        echo: "provider-secret",
        "provider-super-secret": true,
      },
    }, ["provider-secret", "provider-super-secret"]);

    expect(payload.result.url).toBe("https://cdn.example.test/result.png");
    expect(JSON.stringify(payload.data.error)).not.toContain("provider-secret");
    expect(JSON.stringify(payload.data.error)).not.toContain("private-provider.example");
    expect(JSON.stringify(payload.data)).not.toContain("provider-super-secret");
    expect(payload.data.echo).toBe("[REDACTED]");
    expect(payload.data.error_message).not.toContain("private-provider.example");
  });

  it("preserves a successful media URL on the same origin as the request", () => {
    const baseUrl = "https://provider.example";
    const requestUrl = "https://provider.example/v1/generate";
    const mediaUrl = "https://provider.example/results/output.png";
    const payload = sanitizeProviderErrorFields({ result: { url: mediaUrl } }, [
      "provider-secret",
      baseUrl,
      requestUrl,
    ]);

    expect(payload.result.url).toBe(mediaUrl);
  });

  it("includes proxy URI credentials and decoded Basic auth in exact-sensitive values", () => {
    const token = `Basic ${btoa("proxy-user:proxy-password")}`;
    const sensitiveValues = providerErrorSensitiveValues({
      mode: "proxy",
      proxyUri: "http://uri-user:uri-password@proxy.example:8080",
      proxyToken: token,
    });
    const safe = sanitizeProviderErrorText(
      "proxy-password uri-password proxy-user uri-user",
      sensitiveValues,
    );

    expect(safe).not.toContain("proxy-password");
    expect(safe).not.toContain("uri-password");
    expect(safe).not.toContain("proxy-user");
    expect(safe).not.toContain("uri-user");
  });
});
