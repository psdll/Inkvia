import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settings: new Map<string, string>(), admin: true }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: {
  findUnique: async ({ where }: any) => (state.settings.has(where.key) ? { value: state.settings.get(where.key) } : null),
  upsert: async ({ where, create }: any) => { state.settings.set(where.key, create.value); return create; },
} } }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: async () => [
  { id: "one", name: "One", chatModels: ["shared", "new-model"], egressMode: "direct" },
  { id: "two", name: "Two", chatModels: ["shared"], egressMode: "direct" },
] }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: () => ({ ok: state.admin, error: "未登录" }) }));
vi.mock("@/lib/server-auth", () => ({ getUserId: async () => 7 }));
vi.mock("@/lib/llm-routing/resolver", () => ({
  resolveLlmRoute: async () => ({ status: "ready", route: { providerId: "one", providerName: "One", modelId: "shared", status: "ready" } }),
  resolveLlmRouteFromProviders: ({ binding }: any) => ({ status: "ready", route: { ...binding, providerName: binding.providerId, status: "ready", protocol: "openai-chat" } }),
  attachLlmEgressDecision: (route: unknown) => route,
}));
vi.mock("@/lib/providers/proxy-config", () => ({ readProxySettingRaw: async () => null }));

import { GET as adminGet, POST as adminSave } from "@/app/api/admin/settings/image-edit-models/route";
import { GET as canvasGet } from "@/app/api/canvas/models/route";
import { getLlmModelVisibility, llmVisibilityKey } from "@/lib/llm-routing/visibility";
import { getCreativeAgentChatModels, resolveCreativeAgentModel, validateCreativeAgentOptions } from "@/lib/creative-agent/model-catalog";
const request = (body?: unknown) => new Request("http://localhost/api/models", body ? { method: "POST", body: JSON.stringify(body) } : {}) as any;
const overview = async () => (await adminGet(request())).json();
const save = async (visibility: Record<string, boolean>) => adminSave(request({ visibility, resolutionVisibility: {} }));

describe("LLM display switches", () => {
  beforeEach(() => { state.settings.clear(); state.admin = true; });

  it("lists every registered provider/model with visibility enabled by default", async () => {
    const result = await overview();
    const models = result.models.filter((model: any) => model.category === "llm");
    expect(models.map((model: any) => [model.provider, model.modelId])).toEqual([["one", "shared"], ["one", "new-model"], ["two", "shared"]]);
    expect(models.every((model: any) => result.visibility[model.id])).toBe(true);
  });

  it("persists switches independently and removes a hidden default from canvas metadata", async () => {
    const key = llmVisibilityKey("one", "shared");
    expect((await save({ [key]: false })).status).toBe(200);
    expect((await overview()).visibility[key]).toBe(false);
    const canvas = await (await canvasGet(request())).json();
    expect(canvas.chat.map((model: any) => [model.providerId, model.modelId])).toEqual([["one", "new-model"], ["two", "shared"]]);
    expect(canvas.canvasDefault).toEqual({ status: "hidden" });
    await save({ [key]: true });
    expect((await (await canvasGet(request())).json()).chat).toHaveLength(3);
  });

  it("supports hiding all LLM options without leaking the default", async () => {
    const initial = await overview();
    await save(Object.fromEntries(initial.models.filter((model: any) => model.category === "llm").map((model: any) => [model.id, false])));
    const canvas = await (await canvasGet(request())).json();
    expect(canvas.chat).toEqual([]);
    expect(canvas.canvasDefault).toEqual({ status: "hidden" });
  });

  it("applies saved switches to Agent choices and rejects hidden saved selections", async () => {
    const model = { providerId: "one", modelId: "shared" };
    await save({ [llmVisibilityKey(model.providerId, model.modelId)]: false });
    expect((await getCreativeAgentChatModels()).map(({ providerId, modelId }) => [providerId, modelId])).toEqual([["one", "new-model"], ["two", "shared"]]);
    await expect(resolveCreativeAgentModel(model)).resolves.toMatchObject({ status: "model-disabled" });
    await expect(validateCreativeAgentOptions({ model })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    await save({ [llmVisibilityKey(model.providerId, model.modelId)]: true });
    expect(await getCreativeAgentChatModels()).toHaveLength(3);
    await expect(validateCreativeAgentOptions({ model })).resolves.toMatchObject(model);
  });

  it("leaves Agent choices empty when every text model is hidden", async () => {
    const initial = await overview();
    await save(Object.fromEntries(initial.models.filter((model: any) => model.category === "llm").map((model: any) => [model.id, false])));
    expect(await getCreativeAgentChatModels()).toEqual([]);
  });

  it("preserves LLM switches when an older media-only client saves", async () => {
    const key = llmVisibilityKey("one", "shared");
    await save({ [key]: false });
    await save({ "nano-banana-pro": false });
    expect((await overview()).visibility[key]).toBe(false);
  });

  it("rejects non-admin changes", async () => {
    state.admin = false;
    expect((await save({ [llmVisibilityKey("one", "shared")]: false })).status).toBe(401);
    expect(state.settings.size).toBe(0);
  });

  it("ignores malformed settings and unknown model keys", async () => {
    state.settings.set("llm_model_visibility", "broken json");
    expect(await getLlmModelVisibility()).toEqual({});
    await save({ [llmVisibilityKey("unknown", "unknown")]: false });
    expect((await overview()).visibility[llmVisibilityKey("one", "shared")]).toBe(true);
  });

  const rename = (displayNames: Record<string, unknown>) => adminSave(request({ visibility: {}, resolutionVisibility: {}, displayNames }));

  it("saves independent names for all providers and exposes them without changing model IDs", async () => {
    const one = llmVisibilityKey("one", "shared");
    const two = llmVisibilityKey("two", "shared");
    const added = llmVisibilityKey("one", "new-model");
    expect((await rename({ [one]: "  文本助手  ", [two]: "备用助手", [added]: "新模型" })).status).toBe(200);
    const reloaded = await overview();
    expect(reloaded.displayNames).toMatchObject({ [one]: "文本助手", [two]: "备用助手", [added]: "新模型" });
    expect(reloaded.models.find((model: any) => model.id === one)).toMatchObject({ label: "文本助手", defaultLabel: "shared", modelId: "shared" });
    const canvas = await (await canvasGet(request())).json();
    expect(canvas.chat.map(({ providerId, modelId, label }: any) => [providerId, modelId, label])).toEqual([
      ["one", "shared", "文本助手"], ["one", "new-model", "新模型"], ["two", "shared", "备用助手"],
    ]);
    expect((await getCreativeAgentChatModels()).map(({ providerId, modelId, label }) => [providerId, modelId, label])).toEqual([
      ["one", "shared", "One · 文本助手"], ["one", "new-model", "One · 新模型"], ["two", "shared", "Two · 备用助手"],
    ]);
    await expect(validateCreativeAgentOptions({ model: { providerId: "one", modelId: "shared" } })).resolves.toMatchObject({ providerId: "one", modelId: "shared" });
  });

  it("preserves names when omitted by older clients and while changing visibility", async () => {
    const key = llmVisibilityKey("one", "shared");
    await rename({ [key]: "文本助手" });
    await rename({ "nano-banana-pro": "图片模型" });
    await save({ [key]: false });
    expect((await overview()).displayNames[key]).toBe("文本助手");
    expect((await (await canvasGet(request())).json()).chat.some((model: any) => model.providerId === "one" && model.modelId === "shared")).toBe(false);
    await save({ [key]: true });
    expect((await (await canvasGet(request())).json()).chat.find((model: any) => model.providerId === "one" && model.modelId === "shared").label).toBe("文本助手");
  });

  it.each(["  ", "shared"])("restores the original model name for %j", async (name) => {
    const key = llmVisibilityKey("one", "shared");
    await rename({ [key]: "文本助手" });
    await rename({ [key]: name });
    const result = await overview();
    expect(result.displayNames[key]).toBeUndefined();
    expect(result.models.find((model: any) => model.id === key).label).toBe("shared");
  });

  it("ignores unknown or non-string name edits and rejects unauthenticated edits", async () => {
    const key = llmVisibilityKey("one", "shared");
    await rename({ [key]: "文本助手" });
    await rename({ [key]: null, [llmVisibilityKey("unknown", "shared")]: "未知模型" });
    expect(Object.keys((await overview()).displayNames)).toEqual([key]);
    expect((await overview()).displayNames[key]).toBe("文本助手");
    state.admin = false;
    expect((await rename({ [key]: "未授权修改" })).status).toBe(401);
    state.admin = true;
    expect((await overview()).displayNames[key]).toBe("文本助手");
  });
});

it.each(["broken json", "null", "[]", '{"llm:bad":"false"}', ""])("Task5 Agent selection fails closed for persisted malformed visibility %s", async value => {
  state.settings.set("llm_model_visibility", value);
  await expect(resolveCreativeAgentModel({ providerId: "one", modelId: "shared" })).rejects.toThrow("LLM_VISIBILITY_INVALID");
  await expect(getCreativeAgentChatModels()).rejects.toThrow("LLM_VISIBILITY_INVALID");
});
