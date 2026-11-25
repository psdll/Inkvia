import { describe, expect, it } from "vitest";

import {
  getPublicLegacyLlmFailure,
  LlmRequestError,
  parseLlmError,
} from "@/lib/llm/errors";

describe("legacy LLM error redaction", () => {
  it("removes the active API key, endpoint, authorization values, URLs, and control characters", () => {
    const apiKey = "sk-active-provider-secret";
    const endpoint = "https://internal-llm.example.test/v1/chat/completions";
    const info = parseLlmError(
      "volcengine",
      502,
      JSON.stringify({
        error: {
          code: `reflected-${apiKey}`,
          message: `Authorization: Bearer ${apiKey}\nrequest=${endpoint}?key=${apiKey}\u0000`,
        },
      }),
      "doubao-test",
      [apiKey, endpoint],
    );

    const inspected = JSON.stringify(new LlmRequestError(info));
    expect(info.message).toContain("[REDACTED]");
    expect(info.message).not.toContain(apiKey);
    expect(info.message).not.toContain("internal-llm.example.test");
    expect(info.message).not.toContain("\u0000");
    expect(String(info.code)).not.toContain(apiKey);
    expect(inspected).not.toContain(apiKey);
    expect(inspected).not.toContain("internal-llm.example.test");
  });

  it.each([
    [new LlmRequestError({ provider: "kie.ai", status: 401, message: "raw" }), 502, "LLM 服务认证失败，请联系管理员检查配置", "auth"],
    [new LlmRequestError({ provider: "kie.ai", status: 429, message: "raw" }), 429, "LLM 服务繁忙，请稍后重试", "rate-limit"],
    [new LlmRequestError({ provider: "volcengine", status: 503, message: "raw" }), 502, "LLM 上游服务暂时不可用，请稍后重试", "upstream"],
    [new Error("https://private.example.test sk-secret"), 502, "模型调用失败，请稍后重试", "internal"],
  ])("maps internal failures to stable public output", (error, status, message, category) => {
    const failure = getPublicLegacyLlmFailure(error, "模型调用失败，请稍后重试");

    expect(failure).toEqual(expect.objectContaining({ status, message, category }));
    expect(JSON.stringify(failure)).not.toContain("private.example.test");
    expect(JSON.stringify(failure)).not.toContain("sk-secret");
    expect(Object.keys(failure.logContext).sort()).toEqual(
      error instanceof LlmRequestError
        ? ["category", "provider", "status"].sort()
        : ["category", "status"].sort(),
    );
  });
});
