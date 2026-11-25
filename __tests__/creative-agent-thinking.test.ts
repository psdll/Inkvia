import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: async () => null } } }));
const state = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: async () => [{ id: "bailian", name: "百炼", enabled: state.enabled, egressMode: "direct", chatModels: ["qwen3.8-max", "qwen3.8-flash", "qwen3.8-omni-flash"] }] }));
vi.mock("@/lib/providers/proxy-config", () => ({ readProxySettingRaw: async () => null, resolveProviderProxyFromRaw: vi.fn() }));
vi.mock("@/lib/llm-routing/resolver", () => ({
  resolveLlmRoute: async () => ({ status: "missing-binding" }),
  resolveLlmRouteFromProviders: ({ binding }: any) => ({ status: "ready", route: { ...binding, protocol: "openai-chat" } }),
  attachLlmEgressDecision: (route: unknown) => route,
}));
vi.mock("@/lib/image-edit-models", () => ({ getVisibleImageEditModels: async () => [], getVisibleToolboxModels: async () => [] }));
import { getCreativeAgentModelCatalog, validateCreativeAgentOptions } from "@/lib/creative-agent/model-catalog";
import { creativeAgentMessageSchema } from "@/lib/creative-agent/schemas";
import { getLlmThinkingCapabilities } from "@/lib/llm-routing/reasoning";

beforeEach(() => { state.enabled = false; });
describe("Agent thinking catalog and validation", () => {
  it("retains dormant model capabilities and exposes them after enabling without another migration", async () => {
    expect((await getCreativeAgentModelCatalog()).chat).toEqual([]);
    expect(getLlmThinkingCapabilities({ providerId: "bailian", modelId: "qwen3.8-max" }).thinkingLevels).toContain("high");
    state.enabled = true;
    const catalog = await getCreativeAgentModelCatalog();
    expect(catalog.chat).toHaveLength(3);
    for (const entry of catalog.chat) expect(entry).toMatchObject({ thinkingLevels: ["default", "none", "low", "medium", "high"], reasoningControl: true, thinkingDefault: "high" });
  });
  it.each(["off", "default", "none", "low", "medium", "high"] as const)("accepts supported and legacy choices: %s", async thinkingLevel => {
    state.enabled = true;
    await expect(validateCreativeAgentOptions({ model: { providerId: "bailian", modelId: "qwen3.8-max" }, thinkingLevel })).resolves.toMatchObject({ modelId: "qwen3.8-max" });
  });
  it("rejects unsupported levels and still rejects a disabled model", async () => {
    const model = { providerId: "bailian", modelId: "qwen3.8-max" };
    await expect(validateCreativeAgentOptions({ model, thinkingLevel: "high" })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    state.enabled = true;
    await expect(validateCreativeAgentOptions({ model, thinkingLevel: "max" })).rejects.toMatchObject({ code: "THINKING_UNSUPPORTED" });
  });
  it.each(["default", "none", "max", "adaptive", "off"])("accepts %s at the message schema boundary", thinkingLevel => {
    expect(creativeAgentMessageSchema.safeParse({ messageId: "a508c17a-2fdf-4f22-b48d-92e2d458e194", text: "test", thinkingLevel, baseRevision: "1", selection: { nodeIds: [], edgeIds: [], references: [] } }).success).toBe(true);
  });
});
