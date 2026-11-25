import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: mocks.fetch,
  resolveProviderRequestContext: mocks.context,
}));

import { apimartSubmitMidjourneyV8, buildApimartMidjourneyV8Request } from "@/lib/apimart-midjourney-v8";
import { apimartGetTask, extractApimartImageUrls } from "@/lib/apimart-image";
import { APIMART_MIDJOURNEY_V8_MODEL_ID as model, MIDJOURNEY_V8_RATIOS, isMidjourneyV8Model, mergeMidjourneyV8Options, normalizeMidjourneyV8Options, parseMidjourneyV8PromptFlags, validateMidjourneyOptions } from "@/lib/midjourney-v8";
import { toFriendlyError } from "@/lib/error-friendly";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { getProviderModelCapability, isProviderModelEnabled } from "@/lib/providers/model-availability";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getCanvasImageModelParams, getCanvasImageDisplayCount, getCanvasImageRequestCount } from "@/lib/canvas/image-task";

describe("APIMart Midjourney 8.2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({
      provider: { id: "apimart", baseUrl: "https://saved.example/v1/", apiKey: "saved-apimart-key" },
      decision: { providerId: "apimart", mode: "proxy", cacheKey: "proxy" },
    });
  });

  it("registers a distinct model and backfills capability without changing saved credentials or enablement", () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).toContainEqual(expect.objectContaining({
      id: model, label: "Midjourney", provider: "apimart", upstreamModelId: "midjourney",
    }));
    const builtin = getBuiltinProviders().find(p => p.id === "apimart")!;
    expect(builtin.imageModels).toContain("midjourney");
    const providers = mergeSavedProvidersWithBuiltins([{ ...builtin, enabled: false, apiKey: "saved", imageModels: ["gpt-image-2-official"] }]);
    const saved = providers.find(p => p.id === "apimart")!;
    expect(saved).toMatchObject({ enabled: false, apiKey: "saved", imageModels: expect.arrayContaining(["midjourney", "gpt-image-2-official"]) });
    expect(isProviderModelEnabled(providers, "image", model)).toBe(false);
    expect(isProviderModelEnabled([{ ...saved, enabled: true }], "image", model)).toBe(true);
    expect(getProviderModelCapability("apimart", "image", "midjourney")).toEqual({ adapterBacked: true, usages: ["创作", "画布"] });
  });

  it("matches the existing ratio and fixed-count controls, and stays excluded from batch refreshes", () => {
    expect(isMidjourneyV8Model(model)).toBe(true);
    expect(getCanvasImageModelParams(model).aspectRatios.map(r => r.value)).toEqual([...MIDJOURNEY_V8_RATIOS]);
    expect(getCanvasImageDisplayCount(model, 2)).toBe(4);
    expect(getCanvasImageRequestCount(model, 4)).toBe(1);
    const page = readFileSync("app/image/image-tool.tsx", "utf8");
    expect(page).toContain("const isMidjourneyV8Selected = isMidjourneyV8Model(model)");
    const batch = readFileSync("components/batch-workbench/batch-workbench-page.tsx", "utf8");
    expect(batch.match(/model.id !== "midjourney-v8-apimart"/g)).toHaveLength(2);
  });

  it.each(["relax", "fast", "turbo"])("sends only visible parameters for %s text generation", speed => {
    expect(buildApimartMidjourneyV8Request({ prompt: " mountain ", aspectRatio: "16:9", speed })).toEqual({
      endpoint: "/midjourney/generations",
      action: "imagine",
      body: { prompt: "mountain", version: "8.2", size: "16:9", speed },
    });
  });

  it("uses the dedicated edits route with ordered public references and no model/action/count/advanced fields", () => {
    const request = buildApimartMidjourneyV8Request({ prompt: "edit", imageUrls: ["https://cdn.test/2.png", "https://cdn.test/1.png"], speed: "turbo" });
    expect(request).toEqual({ endpoint: "/midjourney/generations/edits", action: "edits", body: {
      prompt: "edit", version: "8.2", size: "1:1", speed: "turbo",
      image_urls: ["https://cdn.test/2.png", "https://cdn.test/1.png"],
    } });
    for (const field of ["n", "model", "action", "quality", "resolution", "stylize", "chaos", "weird"]) expect(request.body).not.toHaveProperty(field);
    expect(() => buildApimartMidjourneyV8Request({ prompt: "edit", imageUrls: ["/uploads/private.png"] })).toThrow("HTTP(S)");
  });

  it.each([false, true])("submits through saved APIMart credentials and egress (references: %s)", async refs => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ code: 200, data: [{ task_id: "mj-82" }] })));
    const input = { prompt: "draw", ...(refs ? { imageUrls: ["https://cdn.test/ref.png"] } : {}) };
    await expect(apimartSubmitMidjourneyV8(input)).resolves.toMatchObject({ taskId: "mj-82" });
    expect(mocks.context).toHaveBeenCalledWith("apimart");
    const request = buildApimartMidjourneyV8Request(input);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "apimart", mode: "proxy" }),
      `https://saved.example/v1${request.endpoint}`,
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer saved-apimart-key", "Content-Type": "application/json" }, body: JSON.stringify(request.body) }),
    );
  });

  it("polls the unified task endpoint and extracts individual results without the grid", async () => {
    const urls = [1, 2, 3, 4].map(i => `https://cdn.test/${i}.png`);
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: {
      status: "completed", result: { images: urls.map(url => ({ url })), grid_image_url: "https://cdn.test/grid.png" },
    } })));
    const result = await apimartGetTask("mj-82");
    expect(mocks.fetch).toHaveBeenCalledWith(expect.anything(), "https://saved.example/v1/tasks/mj-82?language=zh", expect.objectContaining({ method: "GET" }));
    expect(extractApimartImageUrls(result)).toEqual(urls);
  });

  it("does not retry uncertain submission or accept a missing task id", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(apimartSubmitMidjourneyV8({ prompt: "draw" })).rejects.toThrow("ECONNRESET");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: [] })));
    await expect(apimartSubmitMidjourneyV8({ prompt: "draw" })).rejects.toThrow("任务 ID");
  });
});

describe("Midjourney 8.2 prompt flags and advanced options", () => {
  it("turns trailing --flags into structured fields and strips them from the prompt", () => {
    const parsed = parseMidjourneyV8PromptFlags("a cat in rain --ar 3:4 --s 250 --c 10 --w 50 --seed 42 --no text, watermark --q .5 --style raw --hd --sref https://cdn.test/s.png --sw 300");
    expect(parsed.errors).toEqual([]);
    expect(parsed.prompt).toBe("a cat in rain");
    expect(parsed.size).toBe("3:4");
    expect(parsed.options).toEqual({
      stylize: 250, chaos: 10, weird: 50, seed: 42, negativePrompt: "text, watermark", quality: "0.5",
      raw: true, hd: true, sref: "https://cdn.test/s.png", sw: 300,
    });
  });

  it("keeps unknown flags for the provider and accepts --v 8.2", () => {
    const parsed = parseMidjourneyV8PromptFlags("city --v 8.2 --exp 25 --personalize");
    expect(parsed).toMatchObject({ prompt: "city", errors: [], options: { extra: "--exp 25 --personalize" } });
  });

  it("rejects flags that cannot run, with a reason, before anything is sent", () => {
    const parsed = parseMidjourneyV8PromptFlags("hero --v 6.1 --repeat 4 --s 5000 --ar wide");
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("--v 6.1"), expect.stringContaining("--repeat"),
      expect.stringContaining("--stylize"), expect.stringContaining("--ar"),
    ]));
  });

  it("reads --v / --niji as the version and checks options against what that version supports", () => {
    expect(parseMidjourneyV8PromptFlags("hero --v 7").options.version).toBe("7");
    expect(parseMidjourneyV8PromptFlags("hero --niji 6").options.version).toBe("niji 6");
    expect(validateMidjourneyOptions({ version: "7", hd: true })).toEqual([expect.stringContaining("HD")]);
    expect(validateMidjourneyOptions({ version: "8.1", hd: true })).toEqual([]);
    // 按官方兼容表：草稿只有 V7；V8.x 没有质量参数和极速；V7 系列质量 1/2，V6 系列 0.5/1/2
    expect(validateMidjourneyOptions({ version: "8.1", draft: true })).toEqual([expect.stringContaining("草稿")]);
    expect(validateMidjourneyOptions({ version: "7", draft: true, quality: "2" }, "turbo")).toEqual([]);
    expect(validateMidjourneyOptions({ version: "8.2", quality: "1" })).toEqual([expect.stringContaining("--q")]);
    expect(validateMidjourneyOptions({ version: "8.2" }, "turbo")).toEqual([expect.stringContaining("极速")]);
    expect(validateMidjourneyOptions({ version: "niji 7", quality: "0.5" })).toEqual([expect.stringContaining("1 / 2")]);
    expect(validateMidjourneyOptions({ version: "niji 6", quality: "0.5" })).toEqual([]);
    expect(validateMidjourneyOptions({ version: "niji 7", cref: "https://cdn.test/c.png" })).toEqual([expect.stringContaining("--cref")]);
    expect(validateMidjourneyOptions({ version: "niji 6", cref: "https://cdn.test/c.png", cw: 50 })).toEqual([]);
  });

  it("explains an upstream too-long rejection instead of the generic parameter error", () => {
    const raw = "code=task_failed | message=上游代码=9：上游提交失败：FAST@x：提示词过长，目前支持1024以下字符的提示词（可能与提示词过长（3737字符）有关，建议精简提示词后重试）。已扣额度已自动退还。 | reason=invalid_parameter";
    const friendly = toFriendlyError(raw);
    expect(friendly.message).toContain("3737");
    expect(friendly.message).not.toBe("请求参数不符合接口要求。");
  });

  it("blocks 'clothes' in --no before submitting (Midjourney rejects it as a nudity request)", () => {
    expect(validateMidjourneyOptions({ negativePrompt: "beard, plain black clothes, glasses" })).toEqual([expect.stringContaining("clothes")]);
    expect(validateMidjourneyOptions({ negativePrompt: "beard, unbuttoned shirt, glasses" })).toEqual([]);
  });

  it("shows Midjourney's own reason instead of the generic parameter error", () => {
    const raw = "code=task_failed | message=上游提交失败：FAST@1：Parameters.CustomParse：错误：代码=400 原因=无效参数 消息=--no 后不能有 clothes 元数据=map[] reason=invalid_parameter";
    const friendly = toFriendlyError(raw);
    expect(friendly.message).toContain("clothes");
    expect(friendly.message).not.toBe("请求参数不符合接口要求。");
  });

  it("stops a flag at the end of its line so text appended after it (canvas presets) stays in the prompt", () => {
    const parsed = parseMidjourneyV8PromptFlags("portrait --ar 3:4 --raw\n\n【相机视角要求】\n正面平视 --no text");
    expect(parsed).toMatchObject({ size: "3:4", errors: [], options: { raw: true, negativePrompt: "text" } });
    expect(parsed.prompt).toBe("portrait\n\n【相机视角要求】\n正面平视");
  });

  it("leaves prompts without flags untouched", () => {
    expect(parseMidjourneyV8PromptFlags("  plain prompt — with dash  ")).toEqual({ prompt: "plain prompt — with dash", options: {}, errors: [] });
  });

  it("validates panel options and lets prompt flags win", () => {
    const panel = normalizeMidjourneyV8Options({ stylize: 100, chaos: "7", raw: true, quality: "3", sref: "/local.png" });
    expect(panel.options).toEqual({ stylize: 100, chaos: 7, raw: true });
    expect(panel.errors).toEqual([expect.stringContaining("--quality"), expect.stringContaining("--sref")]);
    expect(mergeMidjourneyV8Options({ stylize: 100, negativePrompt: "blur" }, { stylize: 400, negativePrompt: "text" }))
      .toEqual({ stylize: 400, negativePrompt: "blur, text" });
  });

  it("sends advanced fields only when set, and uses imagine with image_urls for reference mode", () => {
    const request = buildApimartMidjourneyV8Request({
      prompt: "portrait", aspectRatio: "3:4", imageUrls: ["https://cdn.test/ref.png"],
      options: { referenceMode: "imagine", iw: 1.5, stylize: 300, raw: true, hd: true, seed: 7, negativePrompt: "text" },
    });
    expect(request).toEqual({ endpoint: "/midjourney/generations", action: "imagine", body: {
      prompt: "portrait", version: "8.2", size: "3:4", speed: "relax", image_urls: ["https://cdn.test/ref.png"],
      stylize: 300, seed: 7, negative_prompt: "text", raw: true, hd: true, iw: 1.5,
    } });
    expect(request.body).not.toHaveProperty("style");
    const style = buildApimartMidjourneyV8Request({ prompt: "x", imageUrls: ["https://cdn.test/a.png", "https://cdn.test/b.png"], options: { referenceMode: "style", sw: 300 } });
    expect(style).toMatchObject({ endpoint: "/midjourney/generations", action: "imagine", body: { sref: "https://cdn.test/a.png https://cdn.test/b.png", sw: 300 } });
    expect(style.body).not.toHaveProperty("image_urls");
    const edits = buildApimartMidjourneyV8Request({ prompt: "x", imageUrls: ["https://cdn.test/ref.png"], options: { iw: 2 } });
    expect(edits.action).toBe("edits");
    expect(edits.body).not.toHaveProperty("iw");
  });
});

describe("Midjourney versions on APIMart", () => {
  it.each([["8.1", { version: "8.1" }], ["7", { version: "7" }], ["niji 7", { version: "7", niji: true }], ["niji 6", { version: "6", niji: true }]] as const)("sends version %s", (version, fields) => {
    const request = buildApimartMidjourneyV8Request({ prompt: "x", options: { version } });
    expect(request.body).toMatchObject(fields);
    if (!("niji" in fields)) expect(request.body).not.toHaveProperty("niji");
  });

  it("falls back to image-prompt references on versions without edits", () => {
    const v7 = buildApimartMidjourneyV8Request({ prompt: "x", imageUrls: ["https://cdn.test/ref.png"], options: { version: "7" } });
    expect(v7).toMatchObject({ endpoint: "/midjourney/generations", action: "imagine", body: { image_urls: ["https://cdn.test/ref.png"] } });
    const v81 = buildApimartMidjourneyV8Request({ prompt: "x", imageUrls: ["https://cdn.test/ref.png"], options: { version: "8.1" } });
    expect(v81.action).toBe("edits");
  });
});
