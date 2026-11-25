import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const settings = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/prisma", () => ({ default: { appSetting: {
  findUnique: async ({ where }: any) => settings.has(where.key) ? { value: settings.get(where.key) } : null,
  upsert: async ({ where, create }: any) => { settings.set(where.key, create.value); return create; },
} } }));
vi.mock("@/lib/providers/registry", async original => {
  const actual = await original<typeof import("@/lib/providers/registry")>();
  return { ...actual, getRegisteredProviders: async () => actual.getBuiltinProviders().map(provider => ({ ...provider, enabled: true, apiKey: "demo-provider-key", chatModels: [], egressMode: "direct" })) };
});
vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: () => ({ ok: true }) }));
vi.mock("@/lib/server-auth", () => ({ getUserId: async () => 7 }));
vi.mock("@/lib/llm-routing/resolver", () => ({ resolveLlmRoute: async () => ({ status: "missing-binding" }) }));
vi.mock("@/lib/providers/proxy-config", () => ({ readProxySettingRaw: async () => null }));

import { POST as save } from "@/app/api/admin/settings/image-edit-models/route";
import { GET as images } from "@/app/api/image-edit/models/route";
import { GET as toolbox } from "@/app/api/toolbox/models/route";
import { GET as canvas } from "@/app/api/canvas/models/route";
import { GET as batchVideo } from "@/app/api/live-video-batches/models/route";
import { getCreativeAgentModelCatalog } from "@/lib/creative-agent/model-catalog";
import { getToolboxModelsOverview, isImageEditModelVisible, isVideoModelVisible, isAudioModelVisible, isFaceModeVisible } from "@/lib/image-edit-models";
import { resolveGptImage25Selection } from "@/lib/gpt-image-25-models";

const request = (category = "") => new NextRequest(`http://localhost/api/models?category=${category}`);
async function surfaces(category: string): Promise<Record<string, unknown[]>> {
  const [canvasModels, agentModels] = await Promise.all([canvas(request()).then(result => result.json()), getCreativeAgentModelCatalog()]);
  if (category === "face") return { creation: (await (await toolbox(request("face"))).json()).models };
  if (category === "audio") return { canvas: canvasModels.audio };
  if (category === "image") return { creationAndBatch: (await (await images()).json()).models, canvas: canvasModels.image, agent: agentModels.image };
  return { creation: (await (await toolbox(request("video"))).json()).models, batch: (await (await batchVideo()).json()).models, canvas: canvasModels.video, agent: agentModels.video };
}
async function toggle(visibility: Record<string, boolean>) {
  const response = await save(new Request("http://localhost/api/admin/settings/image-edit-models", { method: "POST", body: JSON.stringify({ visibility, resolutionVisibility: {} }) }) as any);
  expect(response.status).toBe(200);
}

beforeEach(() => settings.clear());
describe("saved model switches across creation, batch, canvas and Agent", () => {
  it.each(["image", "video", "audio"])("hides all %s choices and restores the same supported choices when enabled", async category => {
    const models = (await getToolboxModelsOverview()).models.filter(model => model.category === category);
    await toggle(Object.fromEntries(models.map(model => [model.id, true])));
    const enabled = await surfaces(category);
    for (const choices of Object.values(enabled)) expect(choices.length).toBeGreaterThan(0);
    await toggle(Object.fromEntries(models.map(model => [model.id, false])));
    for (const choices of Object.values(await surfaces(category))) expect(choices).toEqual([]);
    for (const model of models) {
      const selection = resolveGptImage25Selection(model.id);
      const visible = category === "image" ? await isImageEditModelVisible(selection.model, selection.gptImage25Mode)
        : category === "video" ? await isVideoModelVisible(model.id)
        : category === "audio" ? await isAudioModelVisible(model.id) : await isFaceModeVisible(model.id);
      expect(visible, model.id).toBe(false);
    }
    await toggle(Object.fromEntries(models.map(model => [model.id, true])));
    expect(await surfaces(category)).toEqual(enabled);
  });

  it("keeps the retired standalone face category empty", async () => {
    expect((await getToolboxModelsOverview()).models.filter(model => model.category === "face")).toEqual([]);
    expect(await surfaces("face")).toEqual({ creation: [] });
  });
});
