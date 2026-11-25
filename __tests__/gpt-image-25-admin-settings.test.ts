import { beforeEach, describe, expect, it, vi } from "vitest";
const settings = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: () => ({ ok: true, username: "admin" }) }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: {
  findUnique: async ({ where }: any) => settings.has(where.key) ? { value: settings.get(where.key) } : null,
  upsert: async ({ where, create, update }: any) => {
    const value = settings.has(where.key) ? update.value : create.value;
    settings.set(where.key, value);
    return { key: where.key, value };
  },
} } }));

import { GET, POST } from "@/app/api/admin/settings/image-edit-models/route";
import { GET as getProductImageModels } from "@/app/api/image-edit/models/route";
import { getVisibleImageEditModels, getVisibleToolboxModels, isImageEditModelVisible } from "@/lib/image-edit-models";
import { expandGptImage25ModelOptions, getAvailableGptImage25Mode } from "@/lib/gpt-image-25-models";

const request = (body?: unknown) => new Request("http://localhost/api/admin/settings/image-edit-models", {
  method: body ? "POST" : "GET",
  ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
}) as any;
const overview = async () => (await GET(request())).json();

describe("independent GPT Image 2.5 admin display settings", () => {
  beforeEach(() => settings.clear());

  it.each(["apimart", "reapi", "aicoming-haiya"])("lists independent Fast and Pro settings for %s and inherits the old switch", async (provider) => {
    const base = `gpt-image-2.5-${provider}`;
    for (const enabled of [true, false]) {
      settings.set("image_edit_model_visibility", JSON.stringify({ [base]: enabled }));
      const result = await overview();
      const entries = result.models.filter((model: any) => model.id.startsWith(base));
      expect(entries.map((model: any) => model.id)).toEqual([`${base}:fast`, `${base}:pro`]);
      expect(entries[0].label).toContain("GPT-Image-2.5 Fast");
      expect(entries[1].label).toContain("GPT-Image-2.5 Pro");
      expect(entries.every((model: any) => model.provider === provider)).toBe(true);
      expect(result.visibility[`${base}:fast`]).toBe(enabled);
      expect(result.visibility[`${base}:pro`]).toBe(enabled);
    }
  });

  it("registers both GPT Image 2.6 options as hidden on upgrade", async () => {
    const base = "gpt-image-2.6-apimart";
    settings.set("image_edit_model_visibility", JSON.stringify({ "gpt-image-2.5-apimart": true }));
    const result = await overview();
    expect(result.models.filter((model: any) => model.id.startsWith(base)).map((model: any) => model.label))
      .toEqual(["GPT-Image-2.6 Fast（am）", "GPT-Image-2.6 Pro（am）"]);
    expect(result.visibility).toMatchObject({ [base]: false, [`${base}:fast`]: false, [`${base}:pro`]: false });
    expect((await getVisibleImageEditModels()).some((model) => model.id === base)).toBe(false);
  });

  it("requires both model visibility and an enabled APIMart provider in the product catalog", async () => {
    const base = "gpt-image-2.6-apimart";
    settings.set("image_edit_model_visibility", JSON.stringify({ [`${base}:pro`]: true }));
    for (const enabled of [false, true]) {
      settings.set("providers.registry", JSON.stringify([{ id: "apimart", enabled }]));
      const result = await (await getProductImageModels()).json();
      const entry = result.models.find((model: any) => model.id === base);
      if (enabled) expect(entry?.gptImage25Variants).toEqual([{ mode: "sunburst", label: "GPT-Image-2.6 Pro（am）" }]);
      else expect(entry).toBeUndefined();
    }
  });

  it.each(["gpt-image-2.5-reapi", "gpt-image-2.6-apimart"])("persists independent names and switches for %s", async (base) => {
    const initial = await overview();
    const result = await POST(request({
      visibility: { ...initial.visibility, [`${base}:fast`]: false, [`${base}:pro`]: true, "nano-banana-pro": false },
      displayNames: { [`${base}:fast`]: "快速版", [`${base}:pro`]: "专业版", "gpt-image-2": "原有名称" },
      resolutionVisibility: initial.resolutionVisibility,
    }));
    expect(result.status).toBe(200);
    const saved = await overview();
    expect(saved.models.find((model: any) => model.id === `${base}:fast`).label).toBe("快速版");
    expect(saved.models.find((model: any) => model.id === `${base}:pro`).label).toBe("专业版");
    for (const models of [await getVisibleImageEditModels(), await getVisibleToolboxModels("image")]) {
      const model = models.find((model) => model.id === base)!;
      expect(model.gptImage25Variants).toEqual([{ mode: "sunburst", label: "专业版" }]);
      expect(expandGptImage25ModelOptions([{ ...model, value: model.id }])).toMatchObject([{ value: `${base}:pro`, label: "专业版" }]);
      expect(getAvailableGptImage25Mode(base, "flare", model.gptImage25Variants)).toBe("sunburst");
      expect(models.some((model) => model.id === "nano-banana-pro")).toBe(false);
      expect(models.find((model) => model.id === "gpt-image-2")?.label).toBe("原有名称");
    }
    expect(await isImageEditModelVisible(base, "flare")).toBe(false);
    expect(await isImageEditModelVisible(base, "sunburst")).toBe(true);

    await POST(request({ ...saved, visibility: { ...saved.visibility, [`${base}:fast`]: true, [`${base}:pro`]: false } }));
    expect(await isImageEditModelVisible(base, "flare")).toBe(true);
    expect(await isImageEditModelVisible(base, "sunburst")).toBe(false);
    expect((await getVisibleImageEditModels()).find((model) => model.id === base)?.gptImage25Variants).toEqual([{ mode: "flare", label: "快速版" }]);

    const current = await overview();
    await POST(request({ ...current, visibility: { ...current.visibility, [`${base}:fast`]: false, [`${base}:pro`]: false } }));
    expect((await getVisibleImageEditModels()).some((model) => model.id === base)).toBe(false);
    expect(await isImageEditModelVisible(base)).toBe(false);
  });

  it("keeps the existing provider suffix preference when splitting a saved base name", async () => {
    settings.set("toolbox_model_display_names", JSON.stringify({ "gpt-image-2.5-apimart": "GPT-Image-2.5" }));
    const result = await overview();
    expect(result.models.filter((model: any) => model.id.startsWith("gpt-image-2.5-apimart")).map((model: any) => model.label))
      .toEqual(["GPT-Image-2.5 Fast", "GPT-Image-2.5 Pro"]);
  });
});
