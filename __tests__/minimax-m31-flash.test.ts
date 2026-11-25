import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/billing/settings", () => ({ readBillingSettings: async () => ({ mode: "strict", rates: [] }) }));
import { MINIMAX_M31_FLASH_MODEL_ID as modelId } from "@/lib/minimax-llm-models";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { isBuiltinProviderModel } from "@/lib/providers/model-availability";
import { categorizeModels } from "@/lib/providers/upstream";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { getLlmProtocolAdapter } from "@/lib/llm-routing/adapters/registry";
import { getLlmModelModalities } from "@/lib/llm-routing/model-modalities";
import { isLlmModelVisible } from "@/lib/llm-routing/visibility";
import { MINIMAX_M31_FLASH_QUOTES } from "@/lib/billing/minimax-pricing";
import { DEFAULT_PRICE_RULES } from "@/lib/billing/default-prices";
import { getBillingCatalog } from "@/lib/billing/catalog";
import { beginLlmCost, finishLlmCost, selectTokenPrices } from "@/lib/billing/llm";

const oldProvider = { ...getBuiltinProviders().find(p => p.id === "minimax")!,
  apiKey: "saved-key", baseUrl: "https://saved.example/v1", chatModels: ["MiniMax-M3", "custom-chat"], enabled: true };
const providers = mergeSavedProvidersWithBuiltins([oldProvider]);
const rules = MINIMAX_M31_FLASH_QUOTES.map((q, i) => ({ id: i + 1, provider: "minimax", model: modelId,
  module: "agent", unitType: q.unitType, unitPrice: q.price, matchConditions: q.conditions, currency: "CNY",
  priority: 100, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, isActive: true }));

describe("MiniMax M3.1 Flash integration", () => {
  it("adds Flash to old saved providers without replacing M3, credentials, or custom models", () => {
    const provider = providers.find(p => p.id === "minimax")!;
    expect(provider).toMatchObject({ apiKey: "saved-key", baseUrl: oldProvider.baseUrl, enabled: true });
    expect(provider.chatModels).toEqual(["MiniMax-M3", "custom-chat", modelId]);
    expect(mergeSavedProvidersWithBuiltins(providers).find(p => p.id === "minimax")?.chatModels).toEqual(provider.chatModels);
    expect(isBuiltinProviderModel("minimax", "chat", modelId)).toBe(true);
    expect(isLlmModelVisible({}, "minimax", modelId)).toBe(true);
    expect(categorizeModels([modelId, "MiniMax-H3"], "minimax")).toEqual({ chat: [modelId], video: ["MiniMax-H3"], image: [] });
    expect(getLlmModelModalities("minimax", modelId)).toEqual({ input: ["text", "image", "video"], output: ["text"] });
  });

  it("streams agent.chat through the saved OpenAI-compatible MiniMax endpoint", () => {
    const result = resolveLlmRouteFromProviders({ scenarioId: "agent.chat", binding: { providerId: "minimax", modelId }, providers });
    expect(result).toMatchObject({ status: "ready", route: { modelId, protocol: "openai-chat", url: "https://saved.example/v1/chat/completions" } });
  });

  it.each(["canvas.chat", "image.role_prompt"] as const)("uses the saved MiniMax Anthropic endpoint for %s", scenarioId => {
    const result = resolveLlmRouteFromProviders({ scenarioId, binding: { providerId: "minimax", modelId }, providers });
    expect(result).toMatchObject({ status: "ready", route: { modelId, protocol: "anthropic-messages", url: "https://saved.example/anthropic/v1/messages" } });
    if (result.status !== "ready") throw new Error(result.status);
    const adapter = getLlmProtocolAdapter(result.route.protocol)!;
    const request = adapter.buildRequest(result.route, [{ role: "system", content: "Return JSON" }, { role: "user", content: [
      { type: "text", text: "describe" }, { type: "image_url", image_url: { url: "https://example.test/a.png" } },
      { type: "video_url", video_url: { url: "https://example.test/a.mp4" } },
    ] }], { tokens: 1024, parameter: "max_completion_tokens" });
    const body = JSON.parse(String(request.init.body));
    expect(body).toEqual({ model: modelId, max_tokens: 1024, stream: false, system: [{ type: "text", text: "Return JSON" }],
      messages: [{ role: "user", content: [{ type: "text", text: "describe" },
        { type: "image", source: { type: "url", url: "https://example.test/a.png" } },
        { type: "video", source: { type: "url", url: "https://example.test/a.mp4" } }] }] });
    // Official default is adaptive thinking / max effort. Never disable thinking
    // or leak OpenAI-only parameters into the Anthropic request.
    for (const field of ["thinking", "reasoning_effort", "response_format", "stream_options", "max_completion_tokens"])
      expect(body).not.toHaveProperty(field);
    expect(adapter.parseSuccess({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "internal" }, { type: "text", text: '{"ok":true}' }] }, 200))
      .toEqual({ ok: true, text: '{"ok":true}' });
  });

  it("preserves disabled-provider and missing-key gates after upgrading saved configuration", () => {
    for (const [overrides, status] of [[{ enabled: false }, "provider-disabled"], [{ apiKey: "" }, "missing-key"]] as const) {
      const upgraded = mergeSavedProvidersWithBuiltins([{ ...oldProvider, ...overrides }]);
      expect(resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: { providerId: "minimax", modelId }, providers: upgraded }).status).toBe(status);
    }
  });

  it("requires exactly the three published CNY tariffs in the catalog and defaults", async () => {
    const db = { appSetting: { findUnique: async () => ({ value: JSON.stringify([oldProvider]) }) }, billingPriceRule: { findMany: async () => rules } };
    const catalog = await getBillingCatalog({ mode: "strict", rates: [], revision: 0 } as any, new Date(), db, { provider: "minimax", model: modelId });
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ enabled: true, historical: false, complete: true });
    expect(catalog[0].slots.map(s => s.unitType).sort()).toEqual(rules.map(r => r.unitType).sort());
    expect(DEFAULT_PRICE_RULES.filter(r => r.model === modelId).map(r => [r.currency, r.unitType, r.unitPrice])).toEqual([
      ["CNY", "input_million_token", 1], ["CNY", "output_million_token", 4], ["CNY", "cached_million_token", 0.1],
    ]);
  });

  it.each([512000, 512001, 900000, undefined])("keeps flat pricing for input count %s", inputTokens => {
    expect(selectTokenPrices(rules, new Date(), inputTokens)).toEqual({ input_million_token: "1", output_million_token: "4", cached_million_token: "0.1" });
  });

  it("settles a long-context response in strict mode without inventing a cache-write tariff", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { billingPriceRule: { findMany: async () => rules }, usageLedger: { create: async () => ({ id: 1 }), updateMany } };
    const call = await beginLlmCost({ provider: "minimax", model: modelId, source: "test" }, db);
    await finishLlmCost(call, { inputTokens: 600000, cachedInputTokens: 100000, outputTokens: 100000 }, true, db);
    expect(updateMany.mock.calls[1][0].data).toMatchObject({ costStatus: "priced", amount: "0.91000000" });
    await expect(beginLlmCost({ provider: "minimax", model: modelId, source: "test" }, { billingPriceRule: { findMany: async () => rules.slice(0, 2) } })).rejects.toThrow("尚未配齐");
  });
});
