import { describe, expect, it } from "vitest";
import { buildLlmThinkingParams, getLlmThinkingCapabilities } from "@/lib/llm-routing/reasoning";
import { openAiChatAdapter } from "@/lib/llm-routing/adapters/openai-chat";
import { anthropicMessagesAdapter } from "@/lib/llm-routing/adapters/anthropic-messages";
import type { ResolvedLlmRoute } from "@/lib/llm-routing/types";

const models = [
  ["volcengine", "doubao-seed-evolving", ["default", "none", "low", "medium", "high"]],
  ["bailian", "qwen3.8-max", ["default", "none", "low", "medium", "high"]],
  ["bailian", "qwen3.8-flash", ["default", "none", "low", "medium", "high"]],
  ["bailian", "qwen3.8-omni-flash", ["default", "none", "low", "medium", "high"]],
  ["deepseek", "deepseek-flash", ["default", "none", "low", "high", "max"]],
  ["deepseek", "deepseek-v4-pro", ["default", "none", "low", "high", "max"]],
  ["minimax", "MiniMax-M3", ["default", "none", "adaptive"]],
] as const;
const route = (providerId: string, modelId: string, protocol: ResolvedLlmRoute["protocol"] = "openai-chat"): ResolvedLlmRoute => ({ providerId, modelId, protocol, providerName: providerId, scenarioId: "canvas.chat", source: "configured", status: "ready", url: "https://example.invalid", apiKey: "fixture", timeoutMs: 1000 });

describe("provider-specific thinking controls", () => {
  it.each(models)("covers %s / %s regardless of visibility", (providerId, modelId, levels) => {
    const target = route(providerId, modelId);
    expect(getLlmThinkingCapabilities(target).thinkingLevels).toEqual(levels);
    for (const level of [undefined, "default", "off"] as const) expect(buildLlmThinkingParams(target, level)).toEqual({});
    for (const level of levels) expect(() => buildLlmThinkingParams(target, level)).not.toThrow();
  });
  it.each(["qwen3.8-max", "qwen3.8-flash", "qwen3.8-omni-flash"])("maps Qwen high to xhigh without a conflicting token budget: %s", modelId => {
    const target = route("bailian", modelId);
    expect(buildLlmThinkingParams(target, "high")).toEqual({ reasoning_effort: "xhigh" });
    expect(buildLlmThinkingParams(target, "none")).toEqual({ reasoning_effort: "none" });
    const body = JSON.parse(String(openAiChatAdapter.buildRequest(target, [], undefined, true, "high").init.body));
    expect(body.reasoning_effort).toBe("xhigh");
    expect(body).not.toHaveProperty("thinking_budget");
    expect(body).not.toHaveProperty("enable_thinking");
  });
  it("keeps Doubao and DeepSeek efforts distinct and explicitly disables thinking", () => {
    for (const target of [route("volcengine", "doubao-seed-evolving"), route("deepseek", "deepseek-v4-pro")]) {
      expect(buildLlmThinkingParams(target, "high")).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "high" });
      expect(buildLlmThinkingParams(target, "none")).toEqual({ thinking: { type: "disabled" } });
    }
    expect(buildLlmThinkingParams(route("deepseek", "deepseek-flash"), "max").reasoning_effort).toBe("max");
    expect(() => buildLlmThinkingParams(route("deepseek", "deepseek-flash"), "medium")).toThrow();
    expect(() => buildLlmThinkingParams(route("volcengine", "doubao-seed-evolving"), "max")).toThrow();
  });
  it("supports only the documented M3 toggle and respects protocol-specific defaults", () => {
    const target = route("minimax", "MiniMax-M3", "anthropic-messages");
    expect(getLlmThinkingCapabilities(target).thinkingDefault).toBe("none");
    expect(getLlmThinkingCapabilities({ ...target, protocol: "openai-chat" }).thinkingDefault).toBe("adaptive");
    expect(() => buildLlmThinkingParams(target, "high")).toThrow();
    for (const [level, type] of [["none", "disabled"], ["adaptive", "adaptive"]] as const) {
      const body = JSON.parse(String(anthropicMessagesAdapter.buildRequest(target, [], undefined, false, level).init.body));
      expect(body.thinking).toEqual({ type });
      expect(body).not.toHaveProperty("reasoning_effort");
      expect(body).not.toHaveProperty("output_config");
    }
  });
  it("does not infer support from model names or unsupported protocols", () => {
    for (const target of [route("custom", "qwen3.8-max"), route("bailian", "future-model"), route("bailian", "qwen3.8-max", "anthropic-messages")]) {
      expect(getLlmThinkingCapabilities(target).thinkingLevels).toEqual(["default"]);
      expect(buildLlmThinkingParams(target, "default")).toEqual({});
      expect(() => buildLlmThinkingParams(target, "high")).toThrow();
    }
  });
});
