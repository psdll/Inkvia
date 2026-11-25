import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosWithProviderEgress: vi.fn(),
  resolveProviderRequestContext: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  axiosWithProviderEgress: mocks.axiosWithProviderEgress,
  resolveProviderRequestContext: mocks.resolveProviderRequestContext,
}));

import { seedanceCreateTask } from "@/lib/seedance";

describe("Seedance 2.5 official request contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProviderRequestContext.mockResolvedValue({
      provider: {
        id: "volcengine",
        baseUrl: "https://ark.cn-beijing.volces.com",
        apiKey: "saved-key",
      },
      decision: { providerId: "volcengine", mode: "direct", cacheKey: "direct" },
    });
    mocks.axiosWithProviderEgress.mockResolvedValue({
      status: 200,
      data: { id: "task-25", status: "submitted" },
    });
  });

  it("sends the exact reference URL for 2.5 edit, auto duration, and MOV while stripping unsupported seed controls", async () => {
    const referenceUrl = "https://ark-test.tos-cn-beijing.volces.com/reference.mov?X-Tos-Signature=fixture";
    await seedanceCreateTask({
      model: "doubao-seedance-2-5-260628",
      prompt: "把参考视频中的汽车改成红色",
      inputMode: "multimodal",
      mediaFiles: [{
        type: "video",
        role: "reference_video",
        url: referenceUrl,
      }],
      resolution: "1080p",
      ratio: "adaptive",
      duration: -1,
      seed: 123,
      cameraFixed: true,
      watermark: true,
      returnLastFrame: true,
      generateAudio: true,
      webSearch: true,
      omniReferenceTaskType: "edit",
      outputFormat: "mov",
    } as any);

    expect(mocks.axiosWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "volcengine" }),
      expect.objectContaining({
        url: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        data: {
          model: "doubao-seedance-2-5-260628",
          content: [
            { type: "text", text: "把参考视频中的汽车改成红色" },
            { type: "video_url", role: "reference_video", video_url: { url: referenceUrl } },
          ],
          resolution: "1080p",
          ratio: "adaptive",
          duration: -1,
          watermark: true,
          return_last_frame: true,
          generate_audio: true,
          omni_reference_task_type: "edit",
          output_format: "mov",
        },
      }),
    );
  });

  it("keeps the existing 2.0 payload unchanged apart from accepting reference audio content", async () => {
    await seedanceCreateTask({
      model: "doubao-seedance-2-0-260128",
      prompt: "按参考画面和音频生成视频",
      inputMode: "multimodal",
      mediaFiles: [
        { type: "image", role: "reference_image", url: "https://cdn.example/reference.png" },
        { type: "audio", role: "reference_audio", url: "https://cdn.example/reference.mp3" },
      ],
      duration: -1,
      generateAudio: false,
      omniReferenceTaskType: "extend",
      outputFormat: "mov",
    } as any);

    const request = mocks.axiosWithProviderEgress.mock.calls[0][1];
    expect(request.data).toEqual({
      model: "doubao-seedance-2-0-260128",
      content: [
        { type: "text", text: "按参考画面和音频生成视频" },
        { type: "image_url", role: "reference_image", image_url: { url: "https://cdn.example/reference.png" } },
        { type: "audio_url", role: "reference_audio", audio_url: { url: "https://cdn.example/reference.mp3" } },
      ],
      generate_audio: false,
    });
  });
});
