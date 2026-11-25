import { describe, expect, it, vi } from "vitest";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins, saveProviders } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { RETIRED_REAPI_LLM_MODELS } from "@/lib/reapi-llm-models";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";

describe("removed provider models", () => {
  it("removes KIE videos from saved providers while preserving active image models", async () => {
    const kie = getBuiltinProviders().find(p => p.id === "kie")!;
    expect(kie.videoModels).toEqual([]);
    expect(new Set(kie.imageModels)).toEqual(new Set(["nano-banana-pro", "nano-banana-2-1", "gpt-image-2"]));
    const old = { ...kie, apiKey: "saved-kie-key", videoModels: ["gemini-omni-video", "grok-video-1.5", "grok-imagine-video-1-5-preview"] };
    expect(mergeSavedProvidersWithBuiltins([old]).find(p => p.id === "kie")).toMatchObject({ apiKey: old.apiKey, imageModels: kie.imageModels, videoModels: [] });
    const upsert = vi.fn().mockResolvedValue({});
    await saveProviders([old], { appSetting: { upsert } } as never);
    expect(JSON.parse(upsert.mock.calls[0][0].update.value)[0]).toEqual({ ...old, videoModels: [] });
  });
  const builtins = getBuiltinProviders();
  it("removes only the two KIE Nano Banana 2 models from old configuration", async () => {
    const kie = builtins.find(p => p.id === "kie")!;
    const removed = ["nano-banana-2", "nano-banana-2-lite"];
    const old = { ...kie, apiKey: "saved-kie-key", imageModels: [...kie.imageModels, ...removed] };
    expect(mergeSavedProvidersWithBuiltins([old]).find(p => p.id === "kie")).toEqual({ ...old, imageModels: kie.imageModels });
    for (const model of removed) expect(isProviderModelEnabled([old], "image", model)).toBe(false);
    for (const model of kie.imageModels) expect(isProviderModelEnabled([old], "image", model)).toBe(true);
    const google = builtins.find(p => p.id === "google-ai-studio")!;
    expect(google.imageModels).toContain("gemini-3.1-flash-image");
    expect(google.imageModels).toContain("gemini-3.1-flash-lite-image");
    const upsert = vi.fn().mockResolvedValue({});
    await saveProviders([old], { appSetting: { upsert } } as never);
    expect(JSON.parse(upsert.mock.calls[0][0].update.value)).toEqual([{ ...old, imageModels: kie.imageModels }]);
  });
  const jiekou = builtins.find((provider) => provider.id === "jiekou")!;
  const reapi = builtins.find((provider) => provider.id === "reapi")!;
  it("removes the entire EasyRouter platform without removing same-name models elsewhere", async () => {
    expect(builtins.some((p) => p.id === "easyrouter")).toBe(false);
    const old = { ...jiekou, id: "easyrouter", apiKey: "saved-easyrouter-key", imageModels: ["gpt-image-2", "image 2"], chatModels: ["gpt-5.5", "gemini-3-flash-preview", "fetched-model"] };
    const other = { ...jiekou, id: "custom-other", chatModels: [...old.chatModels] };
    const providers = mergeSavedProvidersWithBuiltins([old, other]);
    expect(providers.some((p) => p.id === "easyrouter")).toBe(false);
    expect(providers.find((p) => p.id === other.id)?.chatModels).toEqual(other.chatModels);
    expect(resolveLlmRouteFromProviders({
      scenarioId: "agent.chat", providers,
      binding: { providerId: "easyrouter", modelId: "gpt-5.5" },
    })).toEqual({ status: "missing-binding" });
    for (const model of old.chatModels) {
      expect(isProviderModelEnabled([old], "chat", model)).toBe(false);
      expect(isProviderModelEnabled([old, other], "chat", model)).toBe(true);
    }
    expect(providers.find((p) => p.id === "kie")?.imageModels).toContain("gpt-image-2");
    const upsert = vi.fn().mockResolvedValue({});
    await saveProviders([old, other], { appSetting: { upsert } } as never);
    expect(JSON.parse(upsert.mock.calls[0][0].update.value)).toEqual([other]);
  });
  const saved = [
    { ...jiekou, apiKey: "saved-jiekou-key", imageModels: ["gpt-image-2-jiekou", "other-image"] },
    { ...reapi, apiKey: "saved-reapi-key", enabled: true, imageModels: [...reapi.imageModels, "gpt-image-2-official", "gpt-image-2-official-reapi"], chatModels: [...RETIRED_REAPI_LLM_MODELS, "other-chat"] },
  ];

  it("keeps both platforms and reAPI images while removing builtin entries", () => {
    expect(jiekou.imageModels).toEqual([]);
    expect(reapi.chatModels).toEqual([]);
    expect(reapi.imageModels).toEqual(["gpt-image-2.5-flare-official", "gpt-image-2.5-sunburst-official", "midjourney"]);
  });

  it("filters old saved entries without touching keys, other models or other platforms", () => {
    const other = { ...reapi, id: "custom-other", chatModels: [...RETIRED_REAPI_LLM_MODELS] };
    const providers = mergeSavedProvidersWithBuiltins([...saved, other]);
    expect(providers.find((p) => p.id === "jiekou")).toMatchObject({
      apiKey: "saved-jiekou-key", imageModels: ["other-image"],
    });
    expect(providers.find((p) => p.id === "reapi")).toMatchObject({
      apiKey: "saved-reapi-key", imageModels: reapi.imageModels, chatModels: ["other-chat"], enabled: true,
    });
    expect(providers.find((p) => p.id === other.id)?.chatModels).toEqual(RETIRED_REAPI_LLM_MODELS);
    expect(isProviderModelEnabled(saved, "image", "gpt-image-2-jiekou")).toBe(false);
    expect(isProviderModelEnabled(saved, "image", "gpt-image-2-official-reapi")).toBe(false);
  });

  it("does not restore retired models when an old admin page saves its configuration", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    await saveProviders(saved, { appSetting: { upsert } } as never);
    const persisted = JSON.parse(upsert.mock.calls[0][0].update.value);
    expect(persisted[0]).toMatchObject({ id: "jiekou", apiKey: "saved-jiekou-key", imageModels: ["other-image"] });
    expect(persisted[1]).toMatchObject({ id: "reapi", apiKey: "saved-reapi-key", imageModels: reapi.imageModels, chatModels: ["other-chat"] });
  });

  it("also removes both image IDs when migrating the legacy reAPI platform", () => {
    const providers = mergeSavedProvidersWithBuiltins([{ ...saved[1], id: "custom-gpt-image-2-official" }]);
    expect(providers.find((p) => p.id === "reapi")).toMatchObject({
      apiKey: "saved-reapi-key", imageModels: reapi.imageModels,
    });
  });

  it("removes Seedance 1.5 and 1.0 from defaults, saved settings and generation availability", async () => {
    const volcengine = builtins.find((p) => p.id === "volcengine")!;
    const retired = ["doubao-seedance-1-5-pro-251215", "doubao-seedance-1-0-pro-250528"];
    expect(volcengine.videoModels).toEqual([
      "doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628",
      "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615",
    ]);
    const old = { ...volcengine, apiKey: "saved-volcengine-key", videoModels: [...volcengine.videoModels, ...retired] };
    const providers = mergeSavedProvidersWithBuiltins([old]);
    expect(providers.find((p) => p.id === "volcengine")).toMatchObject({
      apiKey: old.apiKey, imageModels: volcengine.imageModels, videoModels: volcengine.videoModels,
    });
    for (const id of retired) expect(isProviderModelEnabled([old], "video", id)).toBe(false);
    const upsert = vi.fn().mockResolvedValue({});
    await saveProviders([old], { appSetting: { upsert } } as never);
    expect(JSON.parse(upsert.mock.calls[0][0].update.value)[0]).toMatchObject({
      apiKey: old.apiKey, videoModels: volcengine.videoModels,
    });
  });
});
