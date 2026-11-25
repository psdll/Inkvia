import { describe, expect, it, vi } from "vitest";
import { creativeAgentMessageSchema } from "@/lib/creative-agent/schemas";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { getVideoModelSpec, SEEDANCE_25_MODEL_ID } from "@/lib/sora2";
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: async () => null } } }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: async () => [{ id: "test", name: "Test", enabled: true, egressMode: "direct", chatModels: ["test"] }, ...["apimart", "volcengine"].map(id => ({ id, name: id, enabled: true, apiKey: "fixture", egressMode: "direct", chatModels: [] }))] }));
vi.mock("@/lib/providers/proxy-config", () => ({ readProxySettingRaw: async () => null }));
vi.mock("@/lib/providers/model-availability", () => ({ isProviderModelEnabled: (_: unknown, _kind: string, model: string) => model !== "disabled" }));
vi.mock("@/lib/llm-routing/resolver", () => ({ resolveLlmRoute: async () => ({ status: "ready", route: { providerId: "test", modelId: "test", protocol: "openai-chat" } }), resolveLlmRouteFromProviders: ({ binding }: any) => ({ status: "ready", route: { ...binding, protocol: "openai-chat" } }), attachLlmEgressDecision: (route: unknown) => route }));
vi.mock("@/lib/image-edit-models", () => ({ getVisibleImageEditModels: async () => [{ id: "gpt-image-2-apimart", label: "Image" }, { id: "disabled", label: "Disabled" }], getVisibleToolboxModels: async () => [{ id: "doubao-seedance-2-5-260628", label: "Video", supportedResolutions: ["480p"], maxDurationSeconds: 15 }] }));
import { getCreativeAgentModelCatalog, resolveCreativeAgentModel, validateCreativeAgentOptions } from "@/lib/creative-agent/model-catalog";
const message = { messageId: "a508c17a-2fdf-4f22-b48d-92e2d458e194", text: "test", baseRevision: "1", selection: { nodeIds: [], edgeIds: [], references: [] } };
describe("structured creation preferences", () => {
  it("does not use a configured platform default without an explicit model", async () => {
    await expect(resolveCreativeAgentModel()).resolves.toEqual({ status: "missing-binding" });
    await expect(validateCreativeAgentOptions({})).rejects.toMatchObject({ code: "MODEL_REQUIRED", status: 400 });
    await expect(validateCreativeAgentOptions({ model: { providerId: "test", modelId: "test" } })).resolves.toMatchObject({ modelId: "test", source: "node-override" });
  });
  it("accepts canonical modes alongside legacy preferences", () => {
    const preferences = { imageModel: "legacy", image: { mode: "auto", params: { aspectRatio: "16:9", resolution: "2K" } }, video: { mode: "explicit", model: SEEDANCE_25_MODEL_ID, params: { duration: 10, generateAudio: false } } };
    expect(creativeAgentMessageSchema.parse({ ...message, preferences }).preferences).toEqual(preferences);
    expect(creativeAgentMessageSchema.safeParse({ ...message, preferences: { imageModel: "legacy" } }).success).toBe(true);
    expect(creativeAgentMessageSchema.safeParse(message).success).toBe(true);
  });
  it.each([
    { image: { mode: "explicit" } }, { image: { mode: "auto", model: "bad" } }, { video: { mode: "unknown" } },
    { image: { mode: "auto", params: { count: 2 } } }, { image: { mode: "auto", params: { quality: 2 } } },
    { video: { mode: "auto", params: { duration: -1 } } }, { video: { mode: "auto", params: { duration: 0 } } },
    { video: { mode: "auto", params: { duration: 2.5 } } }, { video: { mode: "auto", params: { duration: Infinity } } },
    { video: { mode: "auto", params: { generateAudio: "true" } } },
  ])("rejects malformed preferences %j", preferences => expect(creativeAgentMessageSchema.safeParse({ ...message, preferences }).success).toBe(false));
  it("returns live media capabilities without losing existing catalog fields", async () => {
    const catalog = await getCreativeAgentModelCatalog();
    expect(catalog.image).toEqual([{ id: "gpt-image-2-apimart", label: "Image", params: getImageModelParams("gpt-image-2-apimart") }]);
    expect(catalog.video[0]).toMatchObject({ id: SEEDANCE_25_MODEL_ID, label: "Video", params: { ...getVideoModelSpec(SEEDANCE_25_MODEL_ID), label: "Video", supportedResolutions: ["480p"], maxDurationSeconds: 15 } });
    expect(catalog).not.toHaveProperty("defaultModel");
    expect(catalog.chat).toHaveLength(1);
  });
  it("canonical auto wins over a disabled legacy fixed model", async () => {
    await expect(validateCreativeAgentOptions({ model: { providerId: "test", modelId: "test" }, preferences: { imageModel: "disabled", image: { mode: "auto", params: { resolution: "2K" } } } } as any)).resolves.toMatchObject({ modelId: "test" });
  });
  it("rejects disabled canonical models", async () => {
    await expect(validateCreativeAgentOptions({ model: { providerId: "test", modelId: "test" }, preferences: { image: { mode: "explicit", model: "disabled" } } } as any)).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
  });
  it.each([
    { image: { mode: "explicit", model: "gpt-image-2-apimart", params: { resolution: "8K" } } },
    { image: { mode: "explicit", model: "gpt-image-2-apimart", params: { background: "transparent" } } },
    { video: { mode: "explicit", model: SEEDANCE_25_MODEL_ID, params: { duration: 100 } } },
    { video: { mode: "auto", params: { resolution: "8K" } } },
    { image: { mode: "auto", params: { resolution: "8K" } } },
  ])("rejects unsupported fixed constraints without silently downgrading %j", async preferences => {
    await expect(validateCreativeAgentOptions({ model: { providerId: "test", modelId: "test" }, preferences } as any)).rejects.toMatchObject({ code: "MEDIA_PARAMS_INVALID" });
  });
});

it("defers irrelevant media preference eligibility for new v2 submissions", async () => {
  await expect(validateCreativeAgentOptions({ model: { providerId: "test", modelId: "test" }, preferences: { image: { mode: "explicit", model: "disabled" }, video: { mode: "auto", params: { duration: 999 } } } }, { deferMedia: true })).resolves.toMatchObject({ modelId: "test" });
});

it("does not accept client-owned matching snapshots or policy versions", () => {
  for (const extra of [{ matchingPolicyVersion: 2 }, { effectivePreferences: { image: { mode: "auto" } } }, { requirements: { version: 1, facts: [] } }]) {
    expect(creativeAgentMessageSchema.safeParse({ ...message, ...extra }).success).toBe(false);
  }
});
