import { beforeEach, describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ fetch: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: network.fetch,
  resolveProviderRequestContext: network.context,
}));
import {
  buildWorkFisherImageRequest,
  parseWorkFisherImageTask,
  workFisherGetImageTask,
  workFisherSubmitImage,
} from "@/lib/work-fisher-image";
import {
  QWEN_IMAGE_21_MODEL_ID,
  QWEN_IMAGE_21_RATIOS,
  QWEN_IMAGE_21_RESOLUTIONS,
} from "@/lib/work-fisher-image-params";
import {
  getBuiltinProviders,
  mergeSavedProvidersWithBuiltins,
  toResolvedProvider,
} from "@/lib/providers/registry";
import {
  isProviderModelEnabled,
  getProviderModelCapability,
} from "@/lib/providers/model-availability";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import {
  getGptImage2OfficialBatchOptions,
  normalizeGptImage2OfficialBatchSettings,
} from "@/components/batch-workbench/batch-settings-panel";

const model = QWEN_IMAGE_21_MODEL_ID;
describe("FisherAI Qwen Image 2.1 request contract", () => {
  it("matches the documented text request, omitting unsupported OpenAI fields", () => {
    const request = buildWorkFisherImageRequest({ prompt: " test image " });
    expect(request).toEqual({
      endpoint: "/image/generations",
      body: {
        model,
        prompt: "test image",
        metadata: { ratio: "3:4", resolution: "2k" },
      },
    });
    for (const key of [
      "n",
      "size",
      "quality",
      "response_format",
      "output_format",
      "image_urls",
      "images",
    ])
      expect(request.body).not.toHaveProperty(key);
  });
  it("preserves ten ordered reference URLs and rejects the eleventh", () => {
    const imageUrls = Array.from(
      { length: 10 },
      (_, i) => `https://cdn.example/${i}.png`,
    );
    expect(
      buildWorkFisherImageRequest({ prompt: "edit", imageUrls }).body.images,
    ).toEqual(imageUrls);
    expect(() =>
      buildWorkFisherImageRequest({
        prompt: "edit",
        imageUrls: [...imageUrls, imageUrls[0]],
      }),
    ).toThrow("10");
    expect(() =>
      buildWorkFisherImageRequest({
        prompt: "edit",
        imageUrls: ["/uploads/local.png"],
      }),
    ).toThrow("HTTP(S)");
  });
  it.each(QWEN_IMAGE_21_RESOLUTIONS)(
    "maps every ratio at %s without an undocumented size restriction",
    (resolution) => {
      for (const aspectRatio of QWEN_IMAGE_21_RATIOS)
        expect(
          buildWorkFisherImageRequest({
            prompt: "test",
            aspectRatio,
            resolution,
          }).body.metadata,
        ).toEqual({ ratio: aspectRatio, resolution: resolution.toLowerCase() });
    },
  );
  it("rejects unsupported ratios, resolutions and blank prompts", () => {
    expect(() =>
      buildWorkFisherImageRequest({ prompt: "test", aspectRatio: "auto" }),
    ).toThrow("比例");
    expect(() =>
      buildWorkFisherImageRequest({ prompt: "test", resolution: "3K" }),
    ).toThrow("分辨率");
    expect(() => buildWorkFisherImageRequest({ prompt: " " })).toThrow(
      "提示词",
    );
  });
});

describe("FisherAI authenticated transport and lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    network.context.mockResolvedValue({
      provider: {
        id: "work-fisher",
        baseUrl: "https://fisher.example/v1/",
        apiKey: "saved-secret",
      },
      decision: { providerId: "work-fisher", mode: "direct" },
    });
  });
  it("submits once with the saved key and provider egress, then polls by encoded task ID", async () => {
    network.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "task_123",
            task_id: "task_123",
            status: "queued",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "success", data: { status: "IN_PROGRESS" } }),
        ),
      );
    expect((await workFisherSubmitImage({ prompt: "test" })).taskId).toBe(
      "task_123",
    );
    expect(network.context).toHaveBeenCalledWith("work-fisher");
    expect(network.fetch.mock.calls[0]).toMatchObject([
      { providerId: "work-fisher" },
      "https://fisher.example/v1/image/generations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer saved-secret",
          "Content-Type": "application/json",
        },
      },
    ]);
    expect(JSON.parse(network.fetch.mock.calls[0][2].body)).toEqual(
      buildWorkFisherImageRequest({ prompt: "test" }).body,
    );
    expect(
      parseWorkFisherImageTask(await workFisherGetImageTask("task/a")),
    ).toMatchObject({ kind: "pending" });
    expect(network.fetch.mock.calls[1][1]).toBe(
      "https://fisher.example/v1/image/generations/task%2Fa",
    );
  });
  it("sanitizes errors and never retries an uncertain submission", async () => {
    network.fetch.mockRejectedValueOnce(
      new Error("network failure saved-secret https://fisher.example/v1"),
    );
    await expect(workFisherSubmitImage({ prompt: "test" })).rejects.not.toThrow(
      "saved-secret",
    );
    expect(network.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects successful HTTP responses without task identity", async () => {
    network.fetch.mockResolvedValueOnce(new Response("{}"));
    await expect(workFisherSubmitImage({ prompt: "test" })).rejects.toThrow(
      "任务 ID",
    );
  });
  it.each(["NOT_START", "SUBMITTED", "IN_PROGRESS"])(
    "keeps %s pending",
    (status) => {
      expect(parseWorkFisherImageTask({ data: { status } })).toEqual({
        kind: "pending",
        providerStatus: status,
      });
    },
  );
  it("extracts the final URL and actual charge, and handles failure and malformed success", () => {
    expect(
      parseWorkFisherImageTask({
        data: {
          status: "SUCCESS",
          result_url: "https://cdn.example/result.png",
          usage: { amount: 0.23, currency: "CNY" },
        },
      }),
    ).toEqual({
      kind: "done",
      urls: ["https://cdn.example/result.png"],
      providerStatus: "SUCCESS",
      providerUsage: { amount: 0.23, currency: "CNY" },
    });
    expect(
      parseWorkFisherImageTask({
        data: { status: "FAILURE", fail_reason: "invalid image" },
      }),
    ).toMatchObject({ kind: "failed", message: "invalid image" });
    expect(
      parseWorkFisherImageTask({ data: { status: "SUCCESS" } }),
    ).toMatchObject({ kind: "done", urls: [] });
    expect(() => parseWorkFisherImageTask({ data: {} })).toThrow(
      "未知任务状态",
    );
  });
});

describe("FisherAI registration and product parameters", () => {
  it("replaces saved legacy model IDs without changing provider credentials or enablement", () => {
    expect(model).toBe("qwen-image-global-2.1");
    const provider = getBuiltinProviders().find((p) => p.id === "work-fisher")!;
    const migrated = mergeSavedProvidersWithBuiltins([
      { ...provider, enabled: true, apiKey: "stored", imageModels: ["qwen-image-2.1", model] },
    ]).find((p) => p.id === "work-fisher")!;
    expect(migrated).toMatchObject({ enabled: true, apiKey: "stored", imageModels: [model] });
    expect(isProviderModelEnabled([migrated], "image", "qwen-image-2.1")).toBe(false);
  });
  it("registers an independent provider with saved-key-only auth and enable gating", () => {
    const provider = getBuiltinProviders().find((p) => p.id === "work-fisher")!;
    expect(provider).toMatchObject({
      enabled: false,
      baseUrl: "https://api.work-fisher.com/v1",
      egressMode: "direct",
      envKeyName: "",
      imageModels: [model],
    });
    expect(toResolvedProvider(provider).hasKey).toBe(false);
    expect(isProviderModelEnabled([provider], "image", model)).toBe(false);
    expect(
      isProviderModelEnabled([{ ...provider, enabled: true }], "image", model),
    ).toBe(true);
    expect(
      getProviderModelCapability("work-fisher", "image", model).usages,
    ).toEqual(["创作", "批量", "画布"]);
    expect(supportsProviderModelFetch(provider)).toBe(false);
    expect(
      mergeSavedProvidersWithBuiltins([
        { ...provider, enabled: true, apiKey: "stored" },
      ]).find((p) => p.id === "work-fisher"),
    ).toMatchObject({ enabled: true, apiKey: "stored" });
  });
  it("offers the exact parameters on Canvas, Agent and both batch modes", () => {
    const params = getImageModelParams(model);
    expect(params.aspectRatios.map((o) => o.value)).toEqual(
      QWEN_IMAGE_21_RATIOS,
    );
    expect(params.resolutions.map((o) => o.value)).toEqual(
      QWEN_IMAGE_21_RESOLUTIONS,
    );
    expect(params).toMatchObject({
      defaultAspectRatio: "3:4",
      defaultResolution: "2K",
      qualities: [],
    });
    expect(
      getGptImage2OfficialBatchOptions(model, "4K", "1:1").ratioOptions.map(
        (o) => o.value,
      ),
    ).toEqual(QWEN_IMAGE_21_RATIOS);
    expect(
      normalizeGptImage2OfficialBatchSettings(model, "3K", "auto"),
    ).toMatchObject({ resolution: "2K", aspectRatio: "3:4" });
    expect(
      createImageTaskSchema.parse({
        model,
        prompt: "test",
        imagePaths: Array(10).fill("/uploads/a.png"),
      }).model,
    ).toBe(model);
    expect(() =>
      createImageTaskSchema.parse({
        model,
        prompt: "test",
        imagePaths: Array(11).fill("/uploads/a.png"),
      }),
    ).toThrow("10");
  });
});
