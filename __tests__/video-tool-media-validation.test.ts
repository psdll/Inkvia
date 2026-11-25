import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/runtime-generation-budget", () => ({ reserveRuntimeGeneration: vi.fn(async () => undefined) }));

type PreparedInput = {
  mediaId: string;
  kind: string;
  localPath: string;
  modelUrl: string;
  position?: number;
  fileName?: string;
  byteSize?: number;
  probe?: {
    version: 1;
    kind: "image" | "video" | "audio";
    detectedMime: string;
    container?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    frameRate?: number;
    videoCodec?: string;
    audioCodecs?: string[];
  };
};

const mocks = vi.hoisted(() => {
  class ToolMediaInputError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  }

  return {
    ToolMediaInputError,
    preparedInputs: [] as PreparedInput[],
    lockedInputs: null as PreparedInput[] | null,
    linkedInputs: [] as Array<PreparedInput & { position: number; role: string }>,
    generationCreate: vi.fn(),
    generationUpdate: vi.fn(),
    inspectToolMediaInputs: vi.fn(),
    createGenerationWithToolMedia: vi.fn(),
    resolveOrderedGenerationInputs: vi.fn(),
    resolveAssetUrlForExternalApi: vi.fn(),
    seedanceCreateTask: vi.fn(),
    kieCreateTask: vi.fn(),
    apimartSubmitVideo: vi.fn(),
    miniMaxSubmitVideo: vi.fn(),
    wanSubmitVideo: vi.fn(),
    loggerGeneration: vi.fn(),
    loggerApi: vi.fn(),
    stat: vi.fn(),
    probeLocalMedia: vi.fn(),
    resolveLocalUploadPath: vi.fn(),
    prisma: {
      $queryRaw: vi.fn(),
      generation: {
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock("node:fs/promises", () => ({
  default: { stat: mocks.stat },
  stat: mocks.stat,
}));
vi.mock("@/lib/tool-media/media-probe", () => ({
  probeLocalMedia: mocks.probeLocalMedia,
  resolveLocalUploadPath: mocks.resolveLocalUploadPath,
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma, default: mocks.prisma }));
vi.mock("@/lib/generation/input-snapshot", () => ({
  snapshotLibraryInputs: vi.fn(async (paths: string[]) => paths),
}));
vi.mock("@/lib/external-assets", () => ({
  resolveAssetUrlForExternalApi: mocks.resolveAssetUrlForExternalApi,
}));
vi.mock("@/lib/logger", () => ({
  Logger: {
    generation: mocks.loggerGeneration,
    api: mocks.loggerApi,
  },
}));
vi.mock("@/lib/kie", () => ({ kieCreateTask: mocks.kieCreateTask }));
vi.mock("@/lib/minimax-video", () => ({ miniMaxSubmitVideo: mocks.miniMaxSubmitVideo }));
vi.mock("@/lib/wan-video", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/wan-video")>(), wanSubmitVideo: mocks.wanSubmitVideo,
}));
vi.mock("@/lib/minimax-h3-concurrency", () => ({ assertMiniMaxH3ConcurrencyAvailable: vi.fn(async () => undefined) }));
vi.mock("@/lib/seedance", () => ({
  detectMediaType: (path: string) => {
    if (path.endsWith(".mp4")) return "video";
    if (path.endsWith(".mp3")) return "audio";
    return "image";
  },
  seedanceCreateTask: mocks.seedanceCreateTask,
}));
vi.mock("@/lib/apimart-video", () => ({
  apimartSubmitVideo: mocks.apimartSubmitVideo,
  isApimartSeedanceFaceModel: (model: string) =>
    model === "doubao-seedance-2.0-face" || model === "doubao-seedance-2.0-fast-face",
}));
vi.mock("@/lib/billing-ledger", () => ({
  upsertUsageLedgerForGenerationId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/admin-asset-feed", () => ({
  upsertAdminAssetFeedForGenerationId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/image-edit-models", () => ({
  isVideoModelVisible: vi.fn(async () => true),
}));
vi.mock("@/lib/providers/model-availability", () => ({
  isProviderModelEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: vi.fn(async () => []),
}));
vi.mock("@/lib/tool-media/generation-inputs", () => ({
  buildToolMediaLogMetadata: (inputs: PreparedInput[]) => ({
    toolMediaCount: inputs.length,
    toolMedia: inputs.map(({ mediaId, kind, localPath, position }) => ({
      mediaId,
      kind,
      localPath,
      position,
    })),
  }),
  ToolMediaInputError: mocks.ToolMediaInputError,
  inspectToolMediaInputs: mocks.inspectToolMediaInputs,
  createGenerationWithToolMedia: mocks.createGenerationWithToolMedia,
  resolveOrderedGenerationInputs: mocks.resolveOrderedGenerationInputs,
}));
vi.mock("@/lib/billing/admission", () => ({ assertBillingReady: vi.fn(async () => undefined) }));

import { createVideoGeneration } from "@/lib/generation/video-service";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const thirdId = "33333333-3333-4333-8333-333333333333";
const fourthId = "44444444-4444-4444-8444-444444444444";

function media(mediaId: string, kind: string): PreparedInput {
  const extension = kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png";
  const probe = kind === "video"
    ? {
        version: 1 as const,
        kind: "video" as const,
        detectedMime: "video/mp4",
        container: "mp4",
        width: 1280,
        height: 720,
        durationSeconds: 2,
        frameRate: 30,
        videoCodec: "h264",
        audioCodecs: ["aac"],
      }
    : kind === "audio"
      ? {
          version: 1 as const,
          kind: "audio" as const,
          detectedMime: "audio/mpeg",
          container: "mp3",
          durationSeconds: 2,
          audioCodecs: ["mp3"],
        }
      : {
          version: 1 as const,
          kind: "image" as const,
          detectedMime: "image/png",
          width: 1280,
          height: 720,
        };
  return {
    mediaId,
    kind,
    localPath: `/uploads/tool_inputs/${mediaId}.${extension}`,
    modelUrl: `https://media.example.com/${mediaId}.${extension}`,
    fileName: `${mediaId}.${extension}`,
    byteSize: 1024,
    probe,
  };
}

function numberedMedia(index: number, kind: string): PreparedInput {
  return media(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, kind);
}

function request(model: string, inputMode: string) {
  return {
    authUserId: 7,
    prompt: "animate",
    model,
    inputMode,
    resolution: "720p",
    ratio: "16:9",
    duration: 5,
    toolMediaIds: mocks.preparedInputs.map((input) => input.mediaId),
  };
}

describe("video tool media provider validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    mocks.preparedInputs = [];
    mocks.lockedInputs = null;
    mocks.linkedInputs = [];
    mocks.generationCreate.mockResolvedValue({ id: 91 });
    mocks.generationUpdate.mockResolvedValue({ id: 91 });
    mocks.resolveAssetUrlForExternalApi.mockImplementation(async (path: string) => `mapped:${path}`);
    mocks.stat.mockResolvedValue({ size: 1024 });
    mocks.resolveLocalUploadPath.mockImplementation((localPath: string) => `C:/public${localPath}`);
    mocks.probeLocalMedia.mockImplementation(async (input: { kind: string; declaredMime: string }) =>
      input.kind === "video"
        ? {
            version: 1,
            kind: "video",
            detectedMime: input.declaredMime,
            container: "mp4",
            width: 1280,
            height: 720,
            durationSeconds: 5,
            frameRate: 30,
            videoCodec: "h264",
            audioCodecs: ["aac"],
          }
        : input.kind === "audio"
          ? {
              version: 1,
              kind: "audio",
              detectedMime: input.declaredMime,
              container: "mp3",
              durationSeconds: 5,
              audioCodecs: ["mp3"],
            }
          : {
              version: 1,
              kind: "image",
              detectedMime: input.declaredMime,
              width: 1280,
              height: 720,
            },
    );
    mocks.seedanceCreateTask.mockResolvedValue({ id: "seedance-task" });
    mocks.kieCreateTask.mockResolvedValue({ taskId: "kie-task" });
    mocks.apimartSubmitVideo.mockResolvedValue({ taskId: "apimart-task", request: {} });
    mocks.miniMaxSubmitVideo.mockResolvedValue({ taskId: "minimax-task", request: {} });
    mocks.wanSubmitVideo.mockResolvedValue({ taskId: "wan-task", request: {} });
    mocks.inspectToolMediaInputs.mockImplementation(async (input) =>
      mocks.preparedInputs.map((item, index) => ({
        ...item,
        position: input.toolMediaPositions?.[index] ?? index,
      })),
    );
    mocks.resolveOrderedGenerationInputs.mockImplementation(async ({
      manifest,
      toolMediaInputs,
      legacyInputs,
    }) => {
      const tools = toolMediaInputs.map((item: PreparedInput) => ({
        ...item,
        source: "tool_media",
      }));
      const legacy = legacyInputs.map((item: PreparedInput) => ({
        ...item,
        source: "legacy_path",
        position: -1,
      }));
      let toolIndex = 0;
      let legacyIndex = 0;
      const ordered = manifest
        ? manifest.items.map((item: { source: string }) =>
            item.source === "tool_media"
              ? tools[toolIndex++]
              : legacy[legacyIndex++],
          )
        : [...tools, ...legacy];
      return ordered.map((item: PreparedInput, position: number) => ({
        ...item,
        position,
      }));
    });
    mocks.createGenerationWithToolMedia.mockImplementation(async (input) => {
      const byId = new Map((mocks.lockedInputs ?? mocks.preparedInputs).map((item) => [item.mediaId, item]));
      const inputs = (input.toolMediaIds || []).map((id: string, index: number) => ({
        ...byId.get(id),
        position: input.toolMediaPositions?.[index] ?? index,
      }));
      const generation = await input.createGeneration(
        { generation: { create: mocks.generationCreate } },
        inputs
      );
      mocks.linkedInputs = inputs.map((item: PreparedInput) => ({
        ...item,
        position: item.position!,
        role: typeof input.role === "function" ? input.role(item, item.position) : input.role,
      }));
      return { generation, inputs };
    });
  });

  it.each(["tool", "canvas", "agent", "batch"] as const)("submits Wan3.0 from %s with ordered references and saved task identity", async (source) => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "video"), media(thirdId, "image"), media(fourthId, "audio")];
    await expect(createVideoGeneration({ ...request("wan3.0-video", "multimodal"), source, prompt: "@图片2 参考 @视频1 配 @音频1", generateAudio: true })).resolves.toMatchObject({ generationId: 91, taskId: "wan-task", status: "running" });
    expect(mocks.wanSubmitVideo).toHaveBeenCalledWith(expect.objectContaining({ prompt: "图2 参考 视频1 配 音频1", generateAudio: true,
      media: mocks.preparedInputs.map((m) => ({ type: m.kind, url: m.modelUrl })) }));
    expect(mocks.generationCreate.mock.calls[0][0].data).toMatchObject({ model: "wan3.0-video", externalProvider: "bailian" });
    expect(mocks.prisma.generation.update).toHaveBeenCalledWith({ where: { id: 91 }, data: { externalTaskId: "wan-task" } });
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it("rejects Wan3.0 input plus output duration before upstream submission", async () => {
    mocks.preparedInputs = [media(firstId, "video")];
    await expect(createVideoGeneration({ ...request("wan3.0-video", "multimodal"), duration: 30 })).rejects.toThrow();
    expect(mocks.wanSubmitVideo).not.toHaveBeenCalled();
  });

  it.each(["tool", "canvas", "agent", "batch"] as const)("compiles Seedance 2.5 mentions at the shared service for %s", async (source) => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "video"), media(thirdId, "image"), media(fourthId, "audio")];
    await createVideoGeneration({
      ...request("doubao-seedance-2-5-260628", "multimodal"), source,
      prompt: "@图片2 参考 @视频1 配 @音频1，保留 @图片10",
    });
    const submitted = mocks.seedanceCreateTask.mock.calls[0][0];
    expect(submitted.prompt).toBe("@image2 参考 @video1 配 @audio1，保留 @图片10");
    expect(submitted.mediaFiles.map((item: { url: string }) => item.url)).toEqual(mocks.preparedInputs.map((item) => item.modelUrl));
  });

  it.each(["tool", "canvas", "agent", "batch"] as const)("preserves no-mention prompts and all media at the shared service for %s", async (source) => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "image")];
    await createVideoGeneration({ ...request("doubao-seedance-2-5-260628", "first_last_frame"), source, ratio: "adaptive", prompt: "从首帧平滑过渡到尾帧" });
    expect(mocks.seedanceCreateTask.mock.calls[0][0]).toMatchObject({
      prompt: "从首帧平滑过渡到尾帧",
      mediaFiles: [
        { url: mocks.preparedInputs[0].modelUrl, role: "first_frame" },
        { url: mocks.preparedInputs[1].modelUrl, role: "last_frame" },
      ],
    });
  });

  it("uses Chinese ordinals for Seedance 2.0 in the shared service", async () => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "image")];
    await createVideoGeneration({ ...request("doubao-seedance-2-0-260128", "first_last_frame"), prompt: "@图片2 参考 @图片1" });
    expect(mocks.seedanceCreateTask.mock.calls[0][0].prompt).toBe("图片2 参考 图片1");
  });

  it("checks the MiniMax prompt limit after compiling reference mentions", async () => {
    mocks.preparedInputs = [media(firstId, "image")];
    const prompt = `@图片1${"字".repeat(6997)}`;
    await createVideoGeneration({ ...request("minimax-h3", "first_frame"), resolution: "768p", ratio: "adaptive", prompt });
    expect(mocks.miniMaxSubmitVideo.mock.calls[0][0].prompt).toBe(prompt.replace("@", ""));
  });

  it("compiles mentions from the locked media types rather than the preflight types", async () => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "image")];
    mocks.lockedInputs = [media(firstId, "video"), media(secondId, "image")];
    await createVideoGeneration({ ...request("doubao-seedance-2-5-260628", "multimodal"), prompt: "@图片1 参考 @视频1" });
    const submitted = mocks.seedanceCreateTask.mock.calls[0][0];
    expect(submitted.prompt).toBe("@image1 参考 @video1");
    expect(submitted.mediaFiles.map((asset: { type: string }) => asset.type)).toEqual(["video", "image"]);
    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).prompt).toBe(submitted.prompt);
  });

  it("compiles ordinary image, video and audio mentions for the Face provider", async () => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "video"), media(thirdId, "audio")];
    await createVideoGeneration({
      ...request("doubao-seedance-2.0-face", "multimodal"),
      prompt: "@图片1 参考 @视频1 配 @音频1",
    });
    expect(mocks.apimartSubmitVideo.mock.calls[0][0]).toMatchObject({
      prompt: "图片1 参考 视频1 配 音频1",
      mediaFiles: [
        { type: "image", url: mocks.preparedInputs[0].modelUrl, role: "reference_image" },
        { type: "video", url: mocks.preparedInputs[1].modelUrl, role: "reference_video" },
        { type: "audio", url: mocks.preparedInputs[2].modelUrl, role: "reference_audio" },
      ],
    });
  });

  it("rejects a retired APIMart reference asset before creating a generation", async () => {
    await expect(createVideoGeneration({
      ...request("doubao-seedance-2.0-face", "multimodal"),
      mediaPaths: ["asset://person-one"],
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("参考素材地址不受支持") });
    expect(mocks.generationCreate).not.toHaveBeenCalled();
    expect(mocks.apimartSubmitVideo).not.toHaveBeenCalled();
  });

  it("adds one reference map for other video models in the shared service", async () => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "image")];
    await createVideoGeneration({ ...request("doubao-seedance-1-5-pro-251215", "first_last_frame"), prompt: "@图片2 参考 @图片1" });
    const prompt = mocks.seedanceCreateTask.mock.calls[0][0].prompt;
    expect(prompt).toContain("图片1：第1张输入参考图");
    expect(prompt).toContain("图片2：第2张输入参考图");
    expect(prompt).toContain("用户需求：\n图片2 参考 图片1");
    expect(prompt.match(/下面是参考素材编号/g)).toHaveLength(1);
  });

  it("stores the original Skill user prompt in video asset parameters", async () => {
    mocks.preparedInputs = [media(firstId, "image")];

    await createVideoGeneration({
      ...request("doubao-seedance-2-0-260128", "first_frame"),
      prompt: "Skill 生成的最终提示词",
      userPrompt: "用户原始提示词",
    });

    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData)).toMatchObject({
      prompt: "Skill 生成的最终提示词",
      userPrompt: "用户原始提示词",
    });
  });

  it("keeps a replayed failed request terminal without creating another provider task", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{
      id: 91,
      status: "failed",
      externalTaskId: null,
      errorMsg: "provider rejected request",
    }]);

    await expect(createVideoGeneration({
      ...request("doubao-seedance-2-0-260128", "multimodal"),
      requestKey: firstId,
    })).rejects.toMatchObject({
      name: "VideoGenerationError",
      generationId: 91,
      displayInHistory: true,
    });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
    expect(mocks.kieCreateTask).not.toHaveBeenCalled();
    expect(mocks.apimartSubmitVideo).not.toHaveBeenCalled();
  });

  it("returns the saved output when a successful request is replayed", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{
      id: 92,
      status: "success",
      externalTaskId: "provider-task-92",
      localPath: "/uploads/videos/92.mp4",
      errorMsg: null,
    }]);

    await expect(createVideoGeneration({
      ...request("doubao-seedance-2-0-260128", "multimodal"),
      requestKey: secondId,
    })).resolves.toEqual({
      generationId: 92,
      taskId: "provider-task-92",
      status: "success",
      outputPaths: ["/uploads/videos/92.mp4"],
    });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-image first frame", [media(firstId, "video")]],
    ["more than one first frame", [media(firstId, "image"), media(secondId, "image")]],
  ])("rejects %s before creating a generation or calling Seedance", async (_name, inputs) => {
    mocks.preparedInputs = inputs;

    await expect(createVideoGeneration(
      request("doubao-seedance-2-0-260128", "first_frame")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it.each([
    ["one frame", [media(firstId, "image")]],
    ["three frames", [media(firstId, "image"), media(secondId, "image"), media(thirdId, "image")]],
    ["a video tail frame", [media(firstId, "image"), media(secondId, "video")]],
  ])("rejects first_last_frame with %s before task creation", async (_name, inputs) => {
    mocks.preparedInputs = inputs;

    await expect(createVideoGeneration(
      request("doubao-seedance-2-0-260128", "first_last_frame")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it("rejects Grok inputs beyond the single image its payload sends", async () => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "image")];

    await expect(createVideoGeneration(
      request("grok-video-1.5", "first_frame")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.kieCreateTask).not.toHaveBeenCalled();
  });

  it.each([
    ["a second video", [media(firstId, "video"), media(secondId, "video")]],
    ["unsupported audio", [media(firstId, "image"), media(secondId, "audio")]],
  ])("rejects Gemini %s that its payload would ignore", async (_name, inputs) => {
    mocks.preparedInputs = inputs;

    await expect(createVideoGeneration(
      request("gemini-omni-video", "multimodal")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.kieCreateTask).not.toHaveBeenCalled();
  });

  it("rejects APIMart media beyond the three videos its request builder sends", async () => {
    mocks.preparedInputs = [
      media(firstId, "video"),
      media(secondId, "video"),
      media(thirdId, "video"),
      media(fourthId, "video"),
    ];

    await expect(createVideoGeneration(
      request("doubao-seedance-2.0-face", "multimodal")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.apimartSubmitVideo).not.toHaveBeenCalled();
  });

  it("links the same ordered multimodal inputs and roles that Seedance receives", async () => {
    mocks.preparedInputs = [
      media(firstId, "video"),
      media(secondId, "image"),
      media(thirdId, "audio"),
    ];

    await createVideoGeneration(
      request("doubao-seedance-2-0-260128", "multimodal")
    );

    expect(mocks.createGenerationWithToolMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMediaIds: [firstId, secondId, thirdId],
      })
    );
    const providerFiles = mocks.seedanceCreateTask.mock.calls[0][0].mediaFiles;
    expect(mocks.linkedInputs.map(({ mediaId, position, role }) => ({ mediaId, position, role }))).toEqual([
      { mediaId: firstId, position: 0, role: "reference_video" },
      { mediaId: secondId, position: 1, role: "reference_image" },
      { mediaId: thirdId, position: 2, role: "reference_audio" },
    ]);
    expect(providerFiles).toEqual(
      mocks.linkedInputs.map(({ kind, modelUrl, role }) => ({
        type: kind,
        url: modelUrl,
        role,
      }))
    );
  });

  it("keeps a legacy first frame before a tool-media last frame", async () => {
    mocks.preparedInputs = [media(firstId, "image")];

    await createVideoGeneration({
      ...request("doubao-seedance-2-0-260128", "first_last_frame"),
      mediaPaths: ["/uploads/product-library/first.png"],
      inputManifest: {
        version: 1,
        items: [
          {
            position: 0,
            source: "legacy_path",
            path: "/uploads/product-library/first.png",
          },
          { position: 1, source: "tool_media", mediaId: firstId },
        ],
      },
    });

    expect(mocks.linkedInputs).toEqual([
      expect.objectContaining({
        mediaId: firstId,
        position: 1,
        role: "last_frame",
      }),
    ]);
    expect(mocks.seedanceCreateTask.mock.calls[0][0].mediaFiles).toEqual([
      {
        type: "image",
        url: "mapped:/uploads/product-library/first.png",
        role: "first_frame",
      },
      {
        type: "image",
        url: `https://media.example.com/${firstId}.png`,
        role: "last_frame",
      },
    ]);
  });

  it("keeps legacy/tool/legacy multimodal provider order and global roles", async () => {
    mocks.preparedInputs = [media(firstId, "video")];

    await createVideoGeneration({
      ...request("doubao-seedance-2-0-260128", "multimodal"),
      mediaPaths: [
        "/uploads/product-library/a.png",
        "/uploads/product-library/c.mp3",
      ],
      inputManifest: {
        version: 1,
        items: [
          {
            position: 0,
            source: "legacy_path",
            path: "/uploads/product-library/a.png",
          },
          { position: 1, source: "tool_media", mediaId: firstId },
          {
            position: 2,
            source: "legacy_path",
            path: "/uploads/product-library/c.mp3",
          },
        ],
      },
    });

    expect(mocks.linkedInputs).toEqual([
      expect.objectContaining({
        mediaId: firstId,
        position: 1,
        role: "reference_video",
      }),
    ]);
    expect(mocks.seedanceCreateTask.mock.calls[0][0].mediaFiles).toEqual([
      {
        type: "image",
        url: "mapped:/uploads/product-library/a.png",
        role: "reference_image",
      },
      {
        type: "video",
        url: `https://media.example.com/${firstId}.mp4`,
        role: "reference_video",
      },
      {
        type: "audio",
        url: "mapped:/uploads/product-library/c.mp3",
        role: "reference_audio",
      },
    ]);
  });

  it("uses the locked Seedance input snapshot for the generation and provider payload", async () => {
    mocks.preparedInputs = [media(firstId, "image")];
    mocks.lockedInputs = [{
      ...media(firstId, "image"),
      localPath: "/uploads/tool_inputs/locked-seedance.mp4",
      modelUrl: "https://media.example.com/locked-seedance.png",
    }];

    await createVideoGeneration(
      request("doubao-seedance-2-0-260128", "first_frame")
    );

    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).imagePaths).toEqual([
      "/uploads/tool_inputs/locked-seedance.mp4",
    ]);
    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).referenceAssets).toEqual([{
      kind: "image",
      url: "/uploads/tool_inputs/locked-seedance.mp4",
      role: "first_frame",
    }]);
    expect(mocks.linkedInputs).toEqual([
      expect.objectContaining({
        mediaId: firstId,
        localPath: "/uploads/tool_inputs/locked-seedance.mp4",
        modelUrl: "https://media.example.com/locked-seedance.png",
        position: 0,
        role: "first_frame",
      }),
    ]);
    expect(mocks.seedanceCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      mediaFiles: [{
        type: "image",
        url: "https://media.example.com/locked-seedance.png",
        role: "first_frame",
      }],
    }));
    expect(mocks.resolveAssetUrlForExternalApi).not.toHaveBeenCalled();
  });

  it("uses the locked Grok input snapshot for the generation and provider payload", async () => {
    mocks.preparedInputs = [media(firstId, "image")];
    mocks.lockedInputs = [{
      ...media(firstId, "image"),
      localPath: "/uploads/tool_inputs/locked-grok.mp4",
      modelUrl: "https://media.example.com/locked-grok.png",
    }];

    await createVideoGeneration(
      request("grok-video-1.5", "first_frame")
    );

    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).imagePaths).toEqual([
      "/uploads/tool_inputs/locked-grok.mp4",
    ]);
    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).referenceAssets).toEqual([{
      kind: "image",
      url: "/uploads/tool_inputs/locked-grok.mp4",
      role: "first_frame",
    }]);
    expect(mocks.linkedInputs[0]).toEqual(expect.objectContaining({
      modelUrl: "https://media.example.com/locked-grok.png",
      role: "first_frame",
    }));
    expect(mocks.kieCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        image_urls: ["https://media.example.com/locked-grok.png"],
      }),
    }));
    expect(mocks.resolveAssetUrlForExternalApi).not.toHaveBeenCalled();
  });

  it("uses the locked Gemini kind and URL for the generation and provider payload", async () => {
    mocks.preparedInputs = [media(firstId, "image")];
    mocks.lockedInputs = [{
      ...media(firstId, "video"),
      localPath: "/uploads/tool_inputs/locked-gemini.png",
      modelUrl: "https://media.example.com/locked-gemini.mp4",
    }];

    await createVideoGeneration(
      request("gemini-omni-video", "multimodal")
    );

    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).imagePaths).toEqual([
      "/uploads/tool_inputs/locked-gemini.png",
    ]);
    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).referenceAssets).toEqual([{
      kind: "video",
      url: "/uploads/tool_inputs/locked-gemini.png",
      role: "reference_video",
    }]);
    expect(mocks.linkedInputs[0]).toEqual(expect.objectContaining({
      kind: "video",
      modelUrl: "https://media.example.com/locked-gemini.mp4",
      role: "reference_video",
    }));
    expect(mocks.kieCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        video_list: [{ url: "https://media.example.com/locked-gemini.mp4", start: 0, ends: 10 }],
      }),
    }));
    expect(mocks.kieCreateTask.mock.calls[0][0].input).not.toHaveProperty("image_urls");
    expect(mocks.resolveAssetUrlForExternalApi).not.toHaveBeenCalled();
  });

  it("uses the locked APIMart kind, URL, and role for the provider payload", async () => {
    mocks.preparedInputs = [media(firstId, "image"), media(secondId, "image")];
    mocks.lockedInputs = [
      {
        ...media(firstId, "audio"),
        localPath: "/uploads/tool_inputs/locked-apimart.png",
        modelUrl: "https://media.example.com/locked-apimart.mp3",
      },
      media(secondId, "image"),
    ];

    await createVideoGeneration(
      request("doubao-seedance-2.0-face", "multimodal")
    );

    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).imagePaths).toEqual([
      "/uploads/tool_inputs/locked-apimart.png",
      media(secondId, "image").localPath,
    ]);
    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData).referenceAssets).toEqual([
      {
        kind: "audio",
        url: "/uploads/tool_inputs/locked-apimart.png",
        role: "reference_audio",
      },
      {
        kind: "image",
        url: media(secondId, "image").localPath,
        role: "reference_image",
      },
    ]);
    expect(mocks.linkedInputs[0]).toEqual(expect.objectContaining({
      kind: "audio",
      modelUrl: "https://media.example.com/locked-apimart.mp3",
      role: "reference_audio",
    }));
    expect(mocks.apimartSubmitVideo).toHaveBeenCalledWith(expect.objectContaining({
      mediaFiles: [
        {
          type: "audio",
          url: "https://media.example.com/locked-apimart.mp3",
          role: "reference_audio",
        },
        {
          type: "image",
          url: media(secondId, "image").modelUrl,
          role: "reference_image",
        },
      ],
    }));
    expect(mocks.resolveAssetUrlForExternalApi).not.toHaveBeenCalled();
  });

  it("keeps signed tool-media URLs out of provider task logs", async () => {
    mocks.preparedInputs = [media(firstId, "image")];
    mocks.lockedInputs = [{
      ...media(firstId, "image"),
      modelUrl:
        "https://media.example.com/locked.png?signature=temporary",
    }];
    mocks.apimartSubmitVideo.mockResolvedValue({
      taskId: "apimart-task",
      request: {
        inputUrl:
          "https://media.example.com/locked.png?signature=temporary",
      },
    });

    await createVideoGeneration(
      request("doubao-seedance-2.0-face", "multimodal"),
    );

    const taskCreate = mocks.loggerGeneration.mock.calls.find(
      ([action]) => action === "task_create",
    );
    const apiRequest = mocks.loggerApi.mock.calls.find(
      ([action]) => action === "apimart_request",
    );
    expect(taskCreate?.[4]).toMatchObject({
      toolMediaCount: 1,
      toolMedia: [
        {
          mediaId: firstId,
          kind: "image",
          localPath: `/uploads/tool_inputs/${firstId}.png`,
        },
      ],
    });
    expect(apiRequest?.[4]).toMatchObject({ toolMediaCount: 1 });
    expect(apiRequest?.[4]).not.toHaveProperty("request");
    expect(
      JSON.stringify([taskCreate?.[4], apiRequest?.[4]]),
    ).not.toContain("signature=temporary");
  });

  it("revalidates Gemini-specific rules against the locked snapshot", async () => {
    mocks.preparedInputs = [media(firstId, "image")];
    mocks.lockedInputs = [media(firstId, "audio")];

    await expect(createVideoGeneration(
      request("gemini-omni-video", "multimodal")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.generationCreate).not.toHaveBeenCalled();
    expect(mocks.linkedInputs).toEqual([]);
    expect(mocks.kieCreateTask).not.toHaveBeenCalled();
    expect(mocks.resolveOrderedGenerationInputs).toHaveBeenCalledOnce();
  });

  it("revalidates APIMart-specific limits against the locked snapshot", async () => {
    mocks.preparedInputs = [
      media(firstId, "image"),
      media(secondId, "image"),
      media(thirdId, "image"),
      media(fourthId, "image"),
    ];
    mocks.lockedInputs = [
      media(firstId, "video"),
      media(secondId, "video"),
      media(thirdId, "video"),
      media(fourthId, "video"),
    ];

    await expect(createVideoGeneration(
      request("doubao-seedance-2.0-face", "multimodal")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.generationCreate).not.toHaveBeenCalled();
    expect(mocks.linkedInputs).toEqual([]);
    expect(mocks.apimartSubmitVideo).not.toHaveBeenCalled();
    expect(mocks.resolveOrderedGenerationInputs).toHaveBeenCalledOnce();
  });

  it.each(["tool", "canvas", "agent", "batch"])("submits APIMart Seedance 2.5 from %s with all 50 references", async (source) => {
    mocks.preparedInputs = [
      ...Array.from({ length: 30 }, (_, index) => numberedMedia(index + 1, "image")),
      ...Array.from({ length: 10 }, (_, index) => numberedMedia(index + 31, "video")),
      ...Array.from({ length: 10 }, (_, index) => numberedMedia(index + 41, "audio")),
    ];
    await createVideoGeneration({
      ...request("seedance-2.5-apimart", "multimodal"),
      source,
      prompt: "@图片2 参考 @视频1 配 @音频1",
    } as any);
    expect(mocks.apimartSubmitVideo).toHaveBeenCalledWith(expect.objectContaining({
      model: "seedance-2.5-apimart", prompt: "@图片2 参考 @视频1 配 @音频1",
      size: "adaptive", duration: -1, omniReferenceTaskType: "auto",
    }));
    expect(mocks.apimartSubmitVideo.mock.calls[0][0].mediaFiles).toHaveLength(50);
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it("persists and submits APIMart edit options for billing and reuse", async () => {
    mocks.preparedInputs = [{ ...media(firstId, "video"), probe: { ...media(firstId, "video").probe!, durationSeconds: 4 } }];
    await createVideoGeneration({ ...request("seedance-2.5-apimart", "multimodal"), ratio: "adaptive", duration: -1, omniReferenceTaskType: "edit", outputFormat: "mov", watermark: true } as any);
    expect(mocks.apimartSubmitVideo).toHaveBeenCalledWith(expect.objectContaining({ size: "adaptive", duration: -1, omniReferenceTaskType: "edit", outputFormat: "mov", watermark: true }));
    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData)).toMatchObject({ omniReferenceTaskType: "edit", outputFormat: "mov", watermark: true });
  });

  it.each(["edit", "extend"])("rejects APIMart %s without a reference video", async (taskType) => {
    mocks.preparedInputs = [media(firstId, "audio")];
    await expect(createVideoGeneration({ ...request("seedance-2.5-apimart", "multimodal"), ratio: "adaptive", duration: -1, omniReferenceTaskType: taskType } as any)).rejects.toMatchObject({ status: 400 });
    expect(mocks.apimartSubmitVideo).not.toHaveBeenCalled();
    expect(mocks.generationCreate).not.toHaveBeenCalled();
  });

  it.each([{ duration: 31 }, { resolution: "4k" }])("rejects unsupported APIMart parameters %j before submission", async (options) => {
    await expect(createVideoGeneration({ ...request("seedance-2.5-apimart", "text_to_video"), ...options } as any)).rejects.toMatchObject({ status: 400 });
    expect(mocks.apimartSubmitVideo).not.toHaveBeenCalled();
  });

  it("accepts the official 50-reference Seedance 2.5 mix", async () => {
    mocks.preparedInputs = [
      ...Array.from({ length: 30 }, (_, index) => numberedMedia(index + 1, "image")),
      ...Array.from({ length: 10 }, (_, index) => numberedMedia(index + 31, "video")),
      ...Array.from({ length: 10 }, (_, index) => numberedMedia(index + 41, "audio")),
    ];

    await createVideoGeneration(
      request("doubao-seedance-2-5-260628", "multimodal")
    );

    expect(mocks.seedanceCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      model: "doubao-seedance-2-5-260628",
      mediaFiles: expect.arrayContaining([
        expect.objectContaining({ type: "image" }),
        expect.objectContaining({ type: "video" }),
        expect.objectContaining({ type: "audio" }),
      ]),
    }));
    expect(mocks.seedanceCreateTask.mock.calls[0][0].mediaFiles).toHaveLength(50);
  });

  it("rejects Seedance 2.5 when an individual reference limit is exceeded", async () => {
    mocks.preparedInputs = Array.from({ length: 31 }, (_, index) => numberedMedia(index + 1, "image"));

    await expect(createVideoGeneration(
      request("doubao-seedance-2-5-260628", "multimodal")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it("allows the official 15-reference mix for the exact Seedance 2.0 model", async () => {
    mocks.preparedInputs = [
      ...Array.from({ length: 9 }, (_, index) => numberedMedia(index + 1, "image")),
      ...Array.from({ length: 3 }, (_, index) => numberedMedia(index + 10, "video")),
      ...Array.from({ length: 3 }, (_, index) => numberedMedia(index + 13, "audio")),
    ];

    await createVideoGeneration(
      request("doubao-seedance-2-0-260128", "multimodal")
    );

    expect(mocks.seedanceCreateTask.mock.calls[0][0].mediaFiles).toHaveLength(15);
  });

  it("rejects standalone audio for exact Seedance 2.0 but accepts it for Seedance 2.5", async () => {
    mocks.preparedInputs = [media(firstId, "audio")];

    await expect(createVideoGeneration(
      request("doubao-seedance-2-0-260128", "multimodal")
    )).rejects.toMatchObject({ status: 400 });
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();

    await createVideoGeneration(
      request("doubao-seedance-2-5-260628", "multimodal")
    );
    expect(mocks.seedanceCreateTask).toHaveBeenCalledOnce();
  });

  it("applies the Seedance 2.0 nine-image limit to Seedance 2.0 Fast", async () => {
    mocks.preparedInputs = Array.from({ length: 10 }, (_, index) => numberedMedia(index + 1, "image"));

    await expect(createVideoGeneration(
      request("doubao-seedance-2-0-fast-260128", "multimodal")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it.each([
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2.0-face",
  ])("rejects an unsupported cached video codec for %s before creating a generation", async (model) => {
    mocks.preparedInputs = [{
      ...media(firstId, "video"),
      probe: { ...media(firstId, "video").probe!, videoCodec: "vp9" },
    }];

    await expect(createVideoGeneration(
      request(model, "multimodal"),
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
    expect(mocks.apimartSubmitVideo).not.toHaveBeenCalled();
  });

  it("normalizes Seedance 2.5 auto video references to safe parameters", async () => {
    mocks.preparedInputs = [media(firstId, "video")];

    await createVideoGeneration({
      ...request("doubao-seedance-2-5-260628", "multimodal"),
      ratio: "16:9",
      duration: 5,
      omniReferenceTaskType: "auto",
    } as any);

    expect(mocks.seedanceCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      ratio: "adaptive",
      duration: -1,
      omniReferenceTaskType: "auto",
    }));
  });

  it("passes validated Seedance 2.5 edit and output options to the provider adapter", async () => {
    mocks.preparedInputs = [{
      ...media(firstId, "video"),
      probe: { ...media(firstId, "video").probe!, durationSeconds: 4 },
    }];

    await createVideoGeneration({
      ...request("doubao-seedance-2-5-260628", "multimodal"),
      ratio: "adaptive",
      duration: -1,
      omniReferenceTaskType: "edit",
      outputFormat: "mov",
    } as any);

    expect(mocks.seedanceCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      omniReferenceTaskType: "edit",
      outputFormat: "mov",
      ratio: "adaptive",
      duration: -1,
    }));
    expect(JSON.parse(mocks.generationCreate.mock.calls[0][0].data.templateData)).toMatchObject({
      omniReferenceTaskType: "edit",
      outputFormat: "mov",
    });
  });

  it.each(["edit", "extend"])("requires a reference video for Seedance 2.5 %s even when no media is submitted", async (taskType) => {
    await expect(createVideoGeneration({
      ...request("doubao-seedance-2-5-260628", "multimodal"),
      ratio: "adaptive",
      duration: taskType === "edit" ? -1 : 5,
      omniReferenceTaskType: taskType,
    } as any)).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-adaptive edit ratio", { ratio: "16:9", duration: -1 }],
    ["a fixed edit duration", { ratio: "adaptive", duration: 5 }],
  ])("rejects Seedance 2.5 edit with %s", async (_name, options) => {
    mocks.preparedInputs = [media(firstId, "video")];

    await expect(createVideoGeneration({
      ...request("doubao-seedance-2-5-260628", "multimodal"),
      ...options,
      omniReferenceTaskType: "edit",
    } as any)).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it("requires adaptive ratio for Seedance 2.5 first-frame generation", async () => {
    mocks.preparedInputs = [media(firstId, "image")];

    await expect(createVideoGeneration(
      request("doubao-seedance-2-5-260628", "first_frame")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).not.toHaveBeenCalled();
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
  });

  it("rejects an invalid locked snapshot before creating a generation, link, or provider task", async () => {
    mocks.preparedInputs = [media(firstId, "image")];
    mocks.lockedInputs = [media(firstId, "video")];

    await expect(createVideoGeneration(
      request("doubao-seedance-2-0-260128", "first_frame")
    )).rejects.toMatchObject({ status: 400 });

    expect(mocks.createGenerationWithToolMedia).toHaveBeenCalledOnce();
    expect(mocks.generationCreate).not.toHaveBeenCalled();
    expect(mocks.linkedInputs).toEqual([]);
    expect(mocks.seedanceCreateTask).not.toHaveBeenCalled();
    expect(mocks.resolveOrderedGenerationInputs).toHaveBeenCalledOnce();
    expect(mocks.resolveAssetUrlForExternalApi).not.toHaveBeenCalled();
  });
});
