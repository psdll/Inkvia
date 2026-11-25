import { beforeEach, describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ fetch: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: network.fetch,
  resolveProviderRequestContext: network.context,
}));
import {
  buildBailianQwenImageRequest,
  getBailianQwenImageBase,
  bailianSubmitQwenImage,
  bailianGetQwenImageTask,
  parseBailianQwenImageTask,
} from "@/lib/bailian-qwen-image";
import {
  QWEN_IMAGE_3_RATIOS,
  QWEN_IMAGE_3_RESOLUTIONS,
} from "@/lib/qwen-image-3-models";
import {
  getImageModelParams,
  normalizeImageQuality,
} from "@/lib/generation/image-model-params";
import {
  getBuiltinProviders,
  mergeSavedProvidersWithBuiltins,
} from "@/lib/providers/registry";
import {
  getProviderModelCapability,
  isProviderModelEnabled,
} from "@/lib/providers/model-availability";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import {
  getGptImage2OfficialBatchOptions,
  normalizeGptImage2OfficialBatchSettings,
} from "@/components/batch-workbench/batch-settings-panel";

const model = "qwen-image-3.0";
describe("Bailian Qwen Image 3.0", () => {
  it("preserves signed image URLs through the real transport sanitizer and parser", async () => {
    const url = "https://cdn.example/result.png?Expires=123&Signature=signed-image-token";
    network.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: {
      task_status: "SUCCEEDED", choices: [{ message: { role: "assistant", content: [{ type: "image", image: url }] } }],
    } })));
    const result = parseBailianQwenImageTask(await bailianGetQwenImageTask("existing-task"));
    expect(result).toMatchObject({ kind: "done", urls: [url] });
  });
  it("still sanitizes terminal error messages with the saved credentials", async () => {
    network.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: { task_status: "FAILED", message: "failed saved-secret https://private.example/path" } })));
    const result = parseBailianQwenImageTask(await bailianGetQwenImageTask("failed-task"));
    expect(result.kind).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("saved-secret");
    expect(JSON.stringify(result)).not.toContain("https://private.example");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    network.context.mockResolvedValue({
      provider: {
        id: "bailian",
        baseUrl: "https://workspace.example/compatible-mode/v1",
        apiKey: "saved-secret",
      },
      decision: { providerId: "bailian", mode: "direct" },
    });
  });
  it.each(["standard", "pro"])(
    "routes %s to the exact upstream model without OpenAI-only fields",
    (quality) => {
      const result = buildBailianQwenImageRequest({
        prompt: " test ",
        quality,
        aspectRatio: "9:16",
        resolution: "2K",
      });
      expect(result).toEqual({
        endpoint: "/api/v1/services/aigc/image-generation/generation",
        body: {
          model: quality === "pro" ? "qwen-image-3.0-pro" : model,
          input: { messages: [{ role: "user", content: [{ text: "test" }] }] },
          parameters: { n: 1, size: "1152*2048", watermark: false },
        },
      });
      for (const field of [
        "quality",
        "resolution",
        "aspect_ratio",
        "response_format",
        "image_urls",
        "mask",
      ])
        expect(result.body).not.toHaveProperty(field);
    },
  );
  it("preserves ordered reference inputs and rejects more than three", () => {
    const imageUrls = [
      "https://cdn.example/1.png",
      "https://cdn.example/2.png",
      "https://cdn.example/3.png",
    ];
    expect(
      buildBailianQwenImageRequest({ prompt: "edit", imageUrls }).body.input
        .messages[0].content,
    ).toEqual([...imageUrls.map((image) => ({ image })), { text: "edit" }]);
    expect(() =>
      buildBailianQwenImageRequest({
        prompt: "edit",
        imageUrls: [...imageUrls, imageUrls[0]],
      }),
    ).toThrow("3 张");
  });
  it("honors the pixel area and billing tier for every explicit ratio and resolution", () => {
    for (const resolution of QWEN_IMAGE_3_RESOLUTIONS)
      for (const aspectRatio of QWEN_IMAGE_3_RATIOS.filter(
        (r) => r !== "auto",
      )) {
        const size = buildBailianQwenImageRequest({
          prompt: "test",
          aspectRatio,
          resolution,
        }).body.parameters.size!;
        const [w, h] = size.split("*").map(Number);
        expect(w * h).toBeGreaterThanOrEqual(512 * 512);
        expect(w * h).toBeLessThanOrEqual(2048 * 2048);
        expect(w * h > 2250000).toBe(resolution === "2K");
      }
    expect(
      buildBailianQwenImageRequest({ prompt: "auto", aspectRatio: "auto" }).body
        .parameters,
    ).not.toHaveProperty("size");
    expect(
      buildBailianQwenImageRequest({
        prompt: "reuse auto history",
        aspectRatio: "auto",
        resolution: "auto",
        quality: "pro",
      }).body.parameters,
    ).not.toHaveProperty("size");
  });
  it("rejects unsupported quality and resolution before submission", () => {
    expect(() =>
      buildBailianQwenImageRequest({ prompt: "test", quality: "high" }),
    ).toThrow("图片质量");
    expect(() =>
      buildBailianQwenImageRequest({ prompt: "test", resolution: "4K" }),
    ).toThrow("清晰度");
    expect(() => buildBailianQwenImageRequest({ prompt: " " })).toThrow(
      "提示词",
    );
  });
  it("uses saved key and egress, async header, and encoded task polling", async () => {
    network.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: { task_id: "qwen-task", task_status: "PENDING" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output: { task_status: "RUNNING" } })),
      );
    expect(await bailianSubmitQwenImage({ prompt: "test" })).toEqual({
      taskId: "qwen-task",
    });
    expect(network.context).toHaveBeenCalledWith("bailian");
    expect(network.fetch.mock.calls[0]).toMatchObject([
      { providerId: "bailian" },
      "https://workspace.example/api/v1/services/aigc/image-generation/generation",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer saved-secret",
          "X-DashScope-Async": "enable",
        },
      },
    ]);
    expect(
      parseBailianQwenImageTask(await bailianGetQwenImageTask("task/a")),
    ).toMatchObject({ kind: "pending" });
    expect(network.fetch.mock.calls[1][1]).toBe(
      "https://workspace.example/api/v1/tasks/task%2Fa",
    );
  });
  it("does not retry ambiguous submission and removes credentials from errors", async () => {
    network.fetch.mockRejectedValueOnce(
      new Error("network saved-secret https://workspace.example"),
    );
    await expect(
      bailianSubmitQwenImage({ prompt: "test" }),
    ).rejects.not.toThrow("saved-secret");
    expect(network.fetch).toHaveBeenCalledTimes(1);
    network.fetch.mockResolvedValueOnce(new Response("{}"));
    await expect(bailianSubmitQwenImage({ prompt: "test" })).rejects.toThrow(
      "提交结果未知",
    );
  });
  it("extracts async choices and usage, with explicit terminal states", () => {
    expect(
      parseBailianQwenImageTask({
        output: {
          task_status: "SUCCEEDED",
          choices: [
            {
              message: { content: [{ image: "https://cdn.example/out.png" }] },
            },
          ],
        },
        usage: { output_image_count: 1 },
      }),
    ).toMatchObject({
      kind: "done",
      urls: ["https://cdn.example/out.png"],
      providerUsage: { output_image_count: 1 },
    });
    for (const task_status of ["FAILED", "CANCELED", "UNKNOWN"])
      expect(parseBailianQwenImageTask({ output: { task_status } }).kind).toBe(
        "failed",
      );
    expect(
      parseBailianQwenImageTask({ output: { task_status: "SUCCEEDED" } }),
    ).toMatchObject({ kind: "done", urls: [] });
    expect(() => parseBailianQwenImageTask({})).toThrow("未知");
  });
  it.each([
    "",
    "/api/v1/",
    "/compatible-mode/v1",
    "/api/v1/services/aigc/image-generation/generation",
    "/api/v1/services/aigc/video-generation/video-synthesis",
  ])("resolves saved base path %s", (suffix) => {
    expect(getBailianQwenImageBase(`https://workspace.example${suffix}`)).toBe(
      "https://workspace.example",
    );
  });
  it("backfills both adapters without altering saved credentials, enabled state or other capabilities", () => {
    const base = getBuiltinProviders().find((p) => p.id === "bailian")!;
    const saved = {
      ...base,
      enabled: false,
      apiKey: "private",
      imageModels: [],
      chatModels: ["saved-chat"],
      videoModels: ["saved-video"],
    };
    const p = mergeSavedProvidersWithBuiltins([saved]).find(
      (p) => p.id === "bailian",
    )!;
    expect(p).toMatchObject({
      enabled: false,
      apiKey: "private",
      chatModels: ["saved-chat"],
      videoModels: ["saved-video"],
      imageModels: [model, "qwen-image-3.0-pro"],
    });
    expect(isProviderModelEnabled([p], "image", model)).toBe(false);
    expect(
      isProviderModelEnabled([{ ...p, enabled: true }], "image", model),
    ).toBe(true);
    for (const upstream of p.imageModels)
      expect(
        getProviderModelCapability("bailian", "image", upstream),
      ).toMatchObject({ adapterBacked: true });
    expect(
      IMAGE_EDIT_MODEL_DEFINITIONS.filter((m) =>
        m.id.startsWith("qwen-image-3"),
      ),
    ).toEqual([
      expect.objectContaining({ id: model, label: "Qwen-Image-3.0" }),
    ]);
  });
  it("shares quality tiers and limits across canvas, batch and Agent", () => {
    expect(getImageModelParams(model)).toMatchObject({
      qualities: [
        { value: "standard", label: "标准" },
        { value: "pro", label: "Pro" },
      ],
      defaultQuality: "standard",
    });
    expect(normalizeImageQuality(model, "pro")).toBe("pro");
    expect(normalizeImageQuality(model, "medium")).toBe("standard");
    expect(
      getGptImage2OfficialBatchOptions(
        model,
        "2K",
        "9:16",
      ).resolutionOptions.map((r) => r.value),
    ).toEqual(["1K", "2K"]);
    expect(
      normalizeGptImage2OfficialBatchSettings(model, "4K", "21:9"),
    ).toMatchObject({
      quality: "standard",
      resolution: "2K",
      aspectRatio: "1:1",
    });
    expect(
      createImageTaskSchema.safeParse({ model, prompt: "test", quality: "pro" })
        .success,
    ).toBe(true);
    expect(
      createImageTaskSchema.safeParse({
        model,
        prompt: "test",
        quality: "high",
      }).success,
    ).toBe(false);
    expect(
      createImageTaskSchema.safeParse({
        model,
        prompt: "test",
        imagePaths: Array(4).fill("https://cdn.example/a.png"),
      }).success,
    ).toBe(false);
  });
});
