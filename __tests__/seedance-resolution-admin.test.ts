import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const settings = new Map<string, string>();
  return {
    settings,
    requireAdminRequest: vi.fn(),
    findUnique: vi.fn(async ({ where }: any) => {
      const value = settings.get(where.key);
      return value === undefined ? null : { value };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const value = settings.has(where.key) ? update.value : create.value;
      settings.set(where.key, value);
      return { key: where.key, value };
    }),
  };
});

vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock("@/lib/prisma", () => ({
  default: { appSetting: { findUnique: mocks.findUnique, upsert: mocks.upsert } },
}));

import { GET, POST } from "@/app/api/admin/settings/image-edit-models/route";
import { getVisibleImageEditModels, getVisibleToolboxModels, isVideoModelVisible } from "@/lib/image-edit-models";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getVideoDisplaySpec } from "@/lib/video-resolution-visibility";
import { getRegisteredProviders } from "@/lib/providers/registry";

function request(method: "GET" | "POST", body?: unknown) {
  return new Request("http://localhost/api/admin/settings/image-edit-models", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as any;
}

describe("Seedance resolution admin settings", () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
  });

  it("returns native resolution controls and persists independent flags", async () => {
    const initial = await (await GET(request("GET"))).json();
    const seedance20 = initial.models.find((model: any) => model.id === "doubao-seedance-2-0-260128");
    const seedanceFast = initial.models.find((model: any) => model.id === "doubao-seedance-2-0-fast-260128");
    const minimaxH3 = initial.models.find((model: any) => model.id === "minimax-h3");
    expect(seedance20.resolutionControls).toEqual(["1080p", "4k"]);
    expect(seedanceFast.resolutionControls).toEqual([]);
    expect(minimaxH3.resolutionControls).toEqual(["2k"]);
    expect(initial.resolutionVisibility[seedance20.id]).toEqual({ "1080p": true, "4k": true });
    expect(initial.resolutionVisibility[minimaxH3.id]).toEqual({ "2k": true });

    const response = await POST(request("POST", {
      visibility: initial.visibility,
      resolutionVisibility: {
        [seedance20.id]: { "1080p": false, "4k": true },
        [minimaxH3.id]: { "2k": false },
      },
    }));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.resolutionVisibility[seedance20.id]).toEqual({ "1080p": false, "4k": true });
    expect(saved.resolutionVisibility[minimaxH3.id]).toEqual({ "2k": false });
    expect(JSON.parse(mocks.settings.get("seedance_video_resolution_visibility") || "{}")[seedance20.id])
      .toEqual({ "1080p": false, "4k": true });
    expect(JSON.parse(mocks.settings.get("seedance_video_resolution_visibility") || "{}")[minimaxH3.id])
      .toEqual({ "2k": false });
  });

  it("renders and submits only server-declared resolution controls", () => {
    const source = readFileSync(resolve(process.cwd(), "components/admin/ImageEditModelsPanel.tsx"), "utf8");
    expect(source).toContain("resolutionControls");
    expect(source).toContain("resolutionVisibility");
    expect(source).toContain("toggleResolution");
    expect(source).toContain("JSON.stringify({ visibility, resolutionVisibility, displayNames, durationVisibility })");
    expect(source).toContain("formatResolutionControlLabel");
    expect(source).toContain("前端显示名称");
  });

  it("shares the API platform order and names without returning credentials", async () => {
    const initial = await (await GET(request("GET"))).json();
    const registered = await getRegisteredProviders();
    expect(initial.providers).toEqual(registered.map(p => ({ id: p.id, name: p.name, enabled: p.enabled !== false })));
    expect(initial.providers.some((p: any) => p.id === "jiekou")).toBe(true);
    expect(initial.providers.every((p: any) => Object.keys(p).sort().join(",") === "enabled,id,name")).toBe(true);
  });

  it("persists independent 30-second controls and Wan 1080P visibility across product capabilities", async () => {
    const initial = await (await GET(request("GET"))).json();
    const wan = "wan3.0-video";
    const seedance = "doubao-seedance-2-5-260628";
    const seedanceApimart = "seedance-2.5-apimart";
    expect(initial.models.find((m: any) => m.id === wan)).toMatchObject({ durationControl: true, resolutionControls: ["1080p"] });
    expect(initial.models.find((m: any) => m.id === seedance).durationControl).toBe(true);
    expect(initial.durationVisibility).toEqual({ [wan]: true, [seedance]: true, [seedanceApimart]: true });
    for (const enabled of [false, true]) {
      const response = await POST(request("POST", { visibility: initial.visibility,
        resolutionVisibility: { ...initial.resolutionVisibility, [wan]: { "1080p": enabled } },
        durationVisibility: { [wan]: enabled, [seedance]: !enabled, [seedanceApimart]: true } }));
      expect(response.status).toBe(200);
      const saved = await (await GET(request("GET"))).json();
      expect(saved.durationVisibility).toEqual({ [wan]: enabled, [seedance]: !enabled, [seedanceApimart]: true });
      const visible = await getVisibleToolboxModels("video");
      const spec = getVideoDisplaySpec(wan, visible);
      expect(spec.maxDurationSeconds).toBe(enabled ? 30 : 15);
      expect(spec.allowAutoDuration).toBe(true);
      expect(spec.supportedResolutions.includes("1080p")).toBe(enabled);
      expect(getVideoDisplaySpec(seedance, visible).maxDurationSeconds).toBe(enabled ? 15 : 30);
      expect(await isVideoModelVisible(wan, "720p", 15)).toBe(true);
      expect(await isVideoModelVisible(wan, "720p", 16)).toBe(enabled);
      expect(await isVideoModelVisible(wan, "720p", 30)).toBe(enabled);
      expect(await isVideoModelVisible(wan, "720p", -1)).toBe(true);
      expect(await isVideoModelVisible(wan, "1080p", 5)).toBe(enabled);
    }
    expect(getVideoDisplaySpec(wan).maxDurationSeconds).toBe(15);
    expect(getVideoDisplaySpec(wan).allowAutoDuration).toBe(true);
  });

  it("rejects invalid duration configuration before any settings are written", async () => {
    const response = await POST(request("POST", { visibility: {}, resolutionVisibility: {}, durationVisibility: [] }));
    expect(response.status).toBe(400);
    expect(mocks.settings.size).toBe(0);
  });

  it("persists duplicate frontend display names without changing model identities", async () => {
    const initial = await (await GET(request("GET"))).json();
    const firstId = "nano-banana-pro";
    const secondId = "gpt-image-2";
    const originalLabels = Object.fromEntries(
      IMAGE_EDIT_MODEL_DEFINITIONS
        .filter((model) => model.id === firstId || model.id === secondId)
        .map((model) => [model.id, model.label]),
    );

    const response = await POST(request("POST", {
      visibility: initial.visibility,
      resolutionVisibility: initial.resolutionVisibility,
      displayNames: {
        [firstId]: "同名模型",
        [secondId]: "同名模型",
        "gpt-image-2-official-reapi": "   ",
      },
    }));
    expect(response.status).toBe(200);
    const saved = await response.json();

    expect(saved.displayNames).toEqual({
      [firstId]: "同名模型",
      [secondId]: "同名模型",
    });
    expect(saved.models.find((model: any) => model.id === firstId)?.label).toBe("同名模型");
    expect(saved.models.find((model: any) => model.id === secondId)?.label).toBe("同名模型");
    expect(IMAGE_EDIT_MODEL_DEFINITIONS.find((model) => model.id === firstId)?.label).toBe(originalLabels[firstId]);
    expect(IMAGE_EDIT_MODEL_DEFINITIONS.find((model) => model.id === secondId)?.label).toBe(originalLabels[secondId]);

    const visibleModels = await getVisibleImageEditModels();
    expect(visibleModels.find((model) => model.id === firstId)?.label).toBe("同名模型");
    expect(visibleModels.find((model) => model.id === secondId)?.label).toBe("同名模型");
  });

  it("uses the admin display name in the video workspace display spec", async () => {
    const modelId = "doubao-seedance-2-0-260128";
    const initial = await (await GET(request("GET"))).json();
    const response = await POST(request("POST", {
      visibility: initial.visibility,
      resolutionVisibility: initial.resolutionVisibility,
      displayNames: { [modelId]: "视频自定义名称" },
    }));
    expect(response.status).toBe(200);

    const visibleVideoModels = await getVisibleToolboxModels("video");
    expect(visibleVideoModels.find((model) => model.id === modelId)?.label).toBe("视频自定义名称");
    expect(getVideoDisplaySpec(modelId, visibleVideoModels).label).toBe("视频自定义名称");
  });

  it("applies model and high-resolution visibility to generation validation", async () => {
    const initial = await (await GET(request("GET"))).json();
    await POST(request("POST", {
      visibility: {
        ...initial.visibility,
        "doubao-seedance-2-0-fast-260128": false,
      },
      resolutionVisibility: {
        "doubao-seedance-2-0-260128": { "1080p": false, "4k": true },
        "minimax-h3": { "2k": false },
      },
    }));

    expect(await isVideoModelVisible("doubao-seedance-2-0-fast-260128")).toBe(false);
    expect(await isVideoModelVisible("doubao-seedance-2-0-260128", "720p")).toBe(true);
    expect(await isVideoModelVisible("doubao-seedance-2-0-260128", "1080p")).toBe(false);
    expect(await isVideoModelVisible("doubao-seedance-2-0-260128", "4k")).toBe(true);
    expect(await isVideoModelVisible("minimax-h3", "768p")).toBe(true);
    expect(await isVideoModelVisible("minimax-h3", "2k")).toBe(false);
  });
});
