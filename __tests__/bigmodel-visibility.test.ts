import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settings: new Map<string, string>(), enabled: true, apiKey: "fixture-key", chatModels: ["glm-5.3-flash"] }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: {
  findUnique: async ({ where }: any) => ({ value: state.settings.get(where.key) || null }),
  upsert: async ({ where, create }: any) => { state.settings.set(where.key, create.value); return create; },
} } }));
vi.mock("@/lib/providers/registry", async original => {
  const actual = await original<typeof import("@/lib/providers/registry")>();
  return { ...actual, getRegisteredProviders: async () => [{ ...actual.getBuiltinProviders().find(provider => provider.id === "bigmodel")!, enabled: state.enabled, apiKey: state.apiKey, chatModels: state.chatModels, baseUrl: "https://saved.example/api/paas/v4", egressMode: "direct" }] };
});
vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: () => ({ ok: true }) }));
vi.mock("@/lib/server-auth", () => ({ getUserId: async () => 7 }));
vi.mock("@/lib/llm-routing/resolver", async original => ({ ...await original<typeof import("@/lib/llm-routing/resolver")>(), resolveLlmRoute: async () => ({ status: "missing-binding" }) }));
vi.mock("@/lib/providers/proxy-config", () => ({ readProxySettingRaw: async () => null }));

import { GET as adminGet, POST as adminSave } from "@/app/api/admin/settings/image-edit-models/route";
import { GET as canvasGet } from "@/app/api/canvas/models/route";
import { getCreativeAgentChatModels, validateCreativeAgentOptions } from "@/lib/creative-agent/model-catalog";
import { llmVisibilityKey } from "@/lib/llm-routing/visibility";
import { evaluateCreativeAgentRuntimeReadiness } from "@/lib/creative-agent/config";
import { CREATIVE_AGENT_PROTOCOL_VERSION } from "@/lib/creative-agent/contracts";

const model = { providerId: "bigmodel", modelId: "glm-5.3-flash" };
let key = llmVisibilityKey(model.providerId, model.modelId);
const request = () => new Request("http://localhost/api/models") as any;
async function toggle(visible: boolean) {
  expect((await adminSave(new Request("http://localhost/api/models", { method: "POST", body: JSON.stringify({ visibility: { [key]: visible }, resolutionVisibility: {} }) }) as any)).status).toBe(200);
}

beforeEach(() => { state.settings.clear(); state.enabled = true; state.apiKey = "fixture-key"; state.chatModels = ["glm-5.3-flash"]; });
describe.each(["glm-5.3", "glm-5.3-flash"])("%s display switch through real Agent routing", modelId => {
  beforeEach(() => { model.modelId = modelId; key = llmVisibilityKey(model.providerId, modelId); state.chatModels = [modelId]; });
  it("shows, hides and restores Flash in both canvas selectors using the saved administrator switch", async () => {
    for (const visible of [true, false, true]) {
      await toggle(visible);
      const admin = await (await adminGet(request())).json();
      expect(admin.visibility[key]).toBe(visible);
      expect((await (await canvasGet(request())).json()).chat.some((item: any) => item.modelId === model.modelId)).toBe(visible);
      const agent = await getCreativeAgentChatModels();
      expect(agent.some(item => item.modelId === model.modelId)).toBe(visible);
      if (!visible) {
        await expect(validateCreativeAgentOptions({ model })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
        continue;
      }
      expect(agent[0]).toMatchObject({ ...model, supportsVision: modelId === "glm-5.3-flash", thinkingLevels: ["default", "low", "high", "max"] });
      const route = await validateCreativeAgentOptions({ model, thinkingLevel: "default" });
      expect(route).toMatchObject({ ...model, protocol: "openai-chat", url: "https://saved.example/api/paas/v4/chat/completions", egressDecision: { providerId: "bigmodel", mode: "direct" } });
      const now = new Date();
      expect(evaluateCreativeAgentRuntimeReadiness({ now, heartbeatValue: JSON.stringify({ successAt: now.toISOString(), protocolVersion: CREATIVE_AGENT_PROTOCOL_VERSION }), llmStatus: route.status, llmProtocol: route.protocol, nodeMajor: 22 }).ready).toBe(true);
    }
  });
  it.each(["disabled", "no-key", "no-model"])("keeps the existing availability gate for %s", async gate => {
    await toggle(true);
    if (gate === "disabled") state.enabled = false;
    if (gate === "no-key") state.apiKey = "";
    if (gate === "no-model") state.chatModels = [];
    expect(await getCreativeAgentChatModels()).toEqual([]);
    await expect(validateCreativeAgentOptions({ model })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });
});
