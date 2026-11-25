import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  generationInputCreateMany: vi.fn(),
  mediaAssetUpdateMany: vi.fn(),
  buildAppPublicUploadUrl: vi.fn(),
  buildOssObjectPublicUrl: vi.fn(),
  isOssPublicUrlConfigured: vi.fn(),
  resolveOssObjectUrlForExternalApi: vi.fn(),
  resolveLocalUploadPathForExternalApiWithRelay: vi.fn(),
  deleteOssObjects: vi.fn(),
  probeLocalMedia: vi.fn(),
  resolveLocalUploadPath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
    mediaAsset: { updateMany: mocks.mediaAssetUpdateMany },
  },
  prisma: {
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/external-assets", () => ({
  buildAppPublicUploadUrl: mocks.buildAppPublicUploadUrl,
  resolveLocalUploadPathForExternalApiWithRelay:
    mocks.resolveLocalUploadPathForExternalApiWithRelay,
}));

vi.mock("@/lib/oss", () => ({
  buildOssObjectPublicUrl: mocks.buildOssObjectPublicUrl,
  isOssPublicUrlConfigured: mocks.isOssPublicUrlConfigured,
  resolveOssObjectUrlForExternalApi: mocks.resolveOssObjectUrlForExternalApi,
  deleteOssObjects: mocks.deleteOssObjects,
}));
vi.mock("@/lib/tool-media/media-probe", () => ({
  probeLocalMedia: mocks.probeLocalMedia,
  resolveLocalUploadPath: mocks.resolveLocalUploadPath,
  readStoredMediaProbe: (metadata: any) => metadata?.mediaProbe,
  mergeStoredMediaProbe: (metadata: any, probe: unknown) => ({ ...(metadata || {}), mediaProbe: probe }),
}));

import {
  buildToolMediaLogMetadata,
  createGenerationWithToolMedia,
  inspectToolMediaInputs,
  normalizeToolMediaIds,
  resolveGenerationInputModelUrls,
  resolveOrderedGenerationInputs,
  ToolMediaInputError,
} from "@/lib/tool-media/generation-inputs";
import { insertMediaItem } from "@/lib/media-item-order";
import { partitionToolMediaInputs } from "@/lib/tool-media/client-draft";
import { buildGenerationPrompt } from "@/lib/generation/prompt-references";
import * as mediaDelivery from "@/lib/media-delivery/deliver";
import { deliverToolMediaForPlatform } from "@/lib/media-delivery/tool-media";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: firstId,
    ownerUserId: 7,
    kind: "image",
    status: "ready",
    originalName: "first.png",
    declaredMime: "image/png",
    detectedMime: null,
    sizeBytes: BigInt(1024),
    originalKey: "/uploads/tool_inputs/2026-07-24/first.png",
    variants: {},
    metadata: { origin: "tool_input" },
    ...overrides,
  };
}

function fakeClient() {
  const tx = {
    $queryRaw: mocks.queryRaw,
    generationInputMedia: { createMany: mocks.generationInputCreateMany },
    mediaAsset: { updateMany: mocks.mediaAssetUpdateMany },
  };
  mocks.transaction.mockImplementation(
    async (callback: (value: typeof tx) => unknown) => callback(tx),
  );
  return {
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
    mediaAsset: { updateMany: mocks.mediaAssetUpdateMany },
  };
}

describe("tool media generation inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildAppPublicUploadUrl.mockImplementation(
      (path: string) => `https://app.example.com${path}`,
    );
    mocks.buildOssObjectPublicUrl.mockImplementation(
      (key: string) => `https://oss.example.com/${key}`,
    );
    mocks.isOssPublicUrlConfigured.mockReturnValue(true);
    mocks.resolveOssObjectUrlForExternalApi.mockResolvedValue(
      "https://oss.example.com/uploads/tool-input-relay/signed.png?signature=fresh",
    );
    mocks.resolveLocalUploadPathForExternalApiWithRelay.mockResolvedValue({
      url: "https://oss.example.com/uploads/tool-input-relay/refreshed.png",
      objectKey: "uploads/tool-input-relay/refreshed.png",
    });
    mocks.generationInputCreateMany.mockResolvedValue({ count: 0 });
    mocks.mediaAssetUpdateMany.mockResolvedValue({ count: 0 });
    mocks.deleteOssObjects.mockResolvedValue({ count: 1 });
    mocks.resolveLocalUploadPath.mockReturnValue("C:/uploads/tool_inputs/2026-07-24/first.png");
    mocks.probeLocalMedia.mockResolvedValue({
      version: 1,
      kind: "image",
      detectedMime: "image/png",
      width: 1280,
      height: 720,
      frameCount: 1,
    });
  });

  it("normalizes UUIDs and preserves input order", () => {
    expect(normalizeToolMediaIds([secondId.toUpperCase(), firstId])).toEqual([
      secondId,
      firstId,
    ]);
    expect(() => normalizeToolMediaIds(["not-a-uuid"])).toThrow(
      ToolMediaInputError,
    );
  });

  it.each([
    [{ platform: "minimax" }, "minimax-h3", "mm_file://123456"],
    [{ platform: "volcengine", model: "doubao-seedance-2-5-260628" }, "doubao-seedance-2-5-260628", "https://ark-temp.example/clip.mp4?X-Tos-Signature=example"],
  ])("uploads %j files before the generation lock and reuses the result", async (target, modelId, url) => {
    vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
    const source = row({
      kind: "video",
      originalName: "clip.mp4",
      originalKey: "/uploads/tool_inputs/clip.mp4",
      metadata: { origin: "tool_input", mediaProbe: { version: 1, kind: "video", detectedMime: "video/mp4" } },
    });
    const endpoint = vi.spyOn(mediaDelivery, "resolveMediaForPlatform").mockImplementation(async () => {
      expect(mocks.transaction).not.toHaveBeenCalled();
      return url;
    });
    try {
      mocks.queryRaw.mockResolvedValue([source]);
      await createGenerationWithToolMedia({
        ownerUserId: 7,
        toolMediaIds: [firstId],
        mediaDeliveryTarget: target,
        modelId,
        client: fakeClient() as never,
        role: "reference_video",
        createGeneration: async (_tx, inputs) => {
          const ordered = await resolveOrderedGenerationInputs({ toolMediaInputs: inputs, legacyInputs: [] });
          const delivered = await deliverToolMediaForPlatform(ordered, "references", target);
          expect(delivered[0].modelUrl).toBe(url);
          return { id: 12 };
        },
      });
      expect(endpoint).toHaveBeenCalledOnce();
      expect(mocks.resolveLocalUploadPathForExternalApiWithRelay).not.toHaveBeenCalled();
    } finally {
      endpoint.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("builds log metadata without a model URL or relay object key", () => {
    expect(
      buildToolMediaLogMetadata([
        {
          mediaId: firstId,
          kind: "image",
          localPath: "/uploads/tool_inputs/2026-07-24/first.png",
          position: 2,
          modelUrl:
            "https://oss.example.com/uploads/tool-input-relay/first.png?signature=temporary",
          relayObjectKey: "uploads/tool-input-relay/first.png",
        },
      ]),
    ).toEqual({
      toolMediaCount: 1,
      toolMedia: [
        {
          mediaId: firstId,
          kind: "image",
          localPath: "/uploads/tool_inputs/2026-07-24/first.png",
          position: 2,
        },
      ],
    });
  });

  it("rejects duplicate normalized UUIDs before starting a transaction or creating a generation", async () => {
    const client = fakeClient();
    const createGeneration = vi.fn();

    expect(() =>
      normalizeToolMediaIds([secondId.toUpperCase(), secondId]),
    ).toThrow(ToolMediaInputError);
    await expect(
      createGenerationWithToolMedia({
        client: client as never,
        ownerUserId: 7,
        toolMediaIds: [secondId.toUpperCase(), secondId],
        role: "reference",
        createGeneration,
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(createGeneration).not.toHaveBeenCalled();
    expect(mocks.generationInputCreateMany).not.toHaveBeenCalled();
  });

  it("locks, creates the generation and ordered links, and clears retention in one transaction", async () => {
    const client = fakeClient();
    mocks.queryRaw.mockResolvedValue([
      row(),
      row({
        id: secondId,
        kind: "video",
        originalKey: "/uploads/tool_inputs/2026-07-24/second.mp4",
        variants: {
          relay: { objectKey: "uploads/tool-input-relay/second.mp4" },
        },
      }),
    ]);
    const createGeneration = vi.fn().mockResolvedValue({ id: 91 });

    const result = await createGenerationWithToolMedia({
      client: client as never,
      ownerUserId: 7,
      toolMediaIds: [secondId, firstId],
      role: (input, position) => `${input.kind}_${position}`,
      createGeneration,
    });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const lockedSql = mocks.queryRaw.mock.calls[0][0];
    expect(lockedSql.strings.join("?")).toContain('FROM "MediaAsset"');
    expect(lockedSql.strings.join("?")).toContain('ORDER BY "id"');
    expect(lockedSql.strings.join("?")).toContain("FOR UPDATE");
    expect(createGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.generationInputCreateMany).toHaveBeenCalledWith({
      data: [
        { generationId: 91, mediaId: secondId, position: 0, role: "video_0" },
        { generationId: 91, mediaId: firstId, position: 1, role: "image_1" },
      ],
    });
    expect(mocks.mediaAssetUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [secondId, firstId] } },
      data: { retentionUntil: null },
    });
    expect(result.inputs.map((input) => input.mediaId)).toEqual([
      secondId,
      firstId,
    ]);
    expect(result.inputs.map((input) => input.modelUrl)).toEqual([
      "https://oss.example.com/uploads/tool-input-relay/second.mp4",
      "https://app.example.com/uploads/tool_inputs/2026-07-24/first.png",
    ]);
  });

  it.each([
    { kind: "image", placement: "before" }, { kind: "image", placement: "after" },
    { kind: "video", placement: "before" }, { kind: "video", placement: "after" },
  ] as const)("persists $kind insertion $placement and resolves model references in the same order", async ({ kind, placement }) => {
    const thirdId = "33333333-3333-4333-8333-333333333333";
    const paths = ["/uploads/tool_inputs/first.png", "/uploads/imports/library.png", "/uploads/tool_inputs/second.png", "/uploads/tool_inputs/third.png"];
    const original = [
      { mediaId: firstId, file: null, url: paths[0] }, { file: null, url: paths[1] },
      { mediaId: secondId, file: null, url: paths[2] }, { mediaId: thirdId, file: null, url: paths[3] },
    ];
    const reordered = insertMediaItem(original, 0, 3, placement);
    const { manifest, toolMediaIds } = partitionToolMediaInputs(reordered);
    const expectedPaths = placement === "before"
      ? [paths[1], paths[2], paths[0], paths[3]] : [paths[1], paths[2], paths[3], paths[0]];
    const client = fakeClient();
    // Database row order differs from the submitted reference order.
    mocks.queryRaw.mockResolvedValue([
      row({ id: firstId, originalKey: paths[0] }),
      row({ id: secondId, originalKey: paths[2] }),
      row({ id: thirdId, originalKey: paths[3] }),
    ]);
    const result = await createGenerationWithToolMedia({
      client: client as never, ownerUserId: 7, toolMediaIds,
      toolMediaPositions: manifest.items.flatMap((item) => item.source === "tool_media" ? [item.position] : []),
      role: "reference_image", createGeneration: async () => ({ id: 92 }),
    });
    expect(mocks.generationInputCreateMany).toHaveBeenCalledWith({
      data: manifest.items.flatMap((item) => item.source === "tool_media"
        ? [{ generationId: 92, mediaId: item.mediaId, position: item.position, role: "reference_image" }] : []),
    });
    const ordered = await resolveOrderedGenerationInputs({
      manifest, toolMediaInputs: result.inputs,
      legacyInputs: [{ manifestPath: paths[1], kind: "image", localPath: paths[1], modelUrl: `https://app.example.com${paths[1]}` }],
    });
    expect(ordered.map((item) => item.localPath)).toEqual(expectedPaths);
    expect(ordered.map((item) => item.position)).toEqual([0, 1, 2, 3]);
    expect(ordered.map((item) => item.modelUrl)).toEqual(expectedPaths.map((path) => `https://app.example.com${path}`));
    const prompt = buildGenerationPrompt({
      kind, model: kind === "image" ? "nano-banana-pro" : "minimax-h3",
      prompt: "@图片1 @图片2 @图片3 @图片4",
      media: ordered.map((item) => ({ kind: "image", url: item.modelUrl })),
    });
    expect(prompt.refs.map((item) => item.url)).toEqual(expectedPaths.map((path) => `https://app.example.com${path}`));
  });

  it("stores absolute tool-media positions across legacy gaps", async () => {
    const client = fakeClient();
    mocks.queryRaw.mockResolvedValue([
      row(),
      row({
        id: secondId,
        originalKey: "/uploads/tool_inputs/2026-07-24/second.png",
      }),
    ]);

    await createGenerationWithToolMedia({
      client: client as never,
      ownerUserId: 7,
      toolMediaIds: [firstId, secondId],
      toolMediaPositions: [0, 2],
      role: (_input, position) => `reference_${position}`,
      createGeneration: vi.fn().mockResolvedValue({ id: 94 }),
    });

    expect(mocks.generationInputCreateMany).toHaveBeenCalledWith({
      data: [
        {
          generationId: 94,
          mediaId: firstId,
          position: 0,
          role: "reference_0",
        },
        {
          generationId: 94,
          mediaId: secondId,
          position: 2,
          role: "reference_2",
        },
      ],
    });
  });

  it.each([
    ["missing", [], 400],
    ["cross owner", [row({ ownerUserId: 8 })], 403],
    ["soft deleted", [row({ status: "soft_deleted" })], 400],
    ["not ready", [row({ status: "processing" })], 400],
    ["missing local source", [row({ originalKey: null })], 400],
    ["not tool input", [row({ metadata: {} })], 400],
  ])("rejects %s before creating a generation", async (_name, rows, status) => {
    const client = fakeClient();
    mocks.queryRaw.mockResolvedValue(rows);
    const createGeneration = vi.fn();

    await expect(
      createGenerationWithToolMedia({
        client: client as never,
        ownerUserId: 7,
        toolMediaIds: [firstId],
        role: "reference",
        createGeneration,
      }),
    ).rejects.toMatchObject({ status });

    expect(createGeneration).not.toHaveBeenCalled();
    expect(mocks.generationInputCreateMany).not.toHaveBeenCalled();
  });

  it("inspects owned inputs before submission without creating a generation", async () => {
    const client = fakeClient();
    mocks.queryRaw.mockResolvedValue([row()]);

    const inputs = await inspectToolMediaInputs({
      client: client as never,
      ownerUserId: 7,
      toolMediaIds: [firstId],
    });

    expect(inputs).toHaveLength(1);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.generationInputCreateMany).not.toHaveBeenCalled();
  });

  it("accepts imports-backed tool input media during preflight", async () => {
    const client = fakeClient();
    mocks.queryRaw.mockResolvedValue([
      row({ originalKey: "/uploads/imports/2026-07-27/first.png" }),
    ]);

    await expect(
      inspectToolMediaInputs({
        client: client as never,
        ownerUserId: 7,
        toolMediaIds: [firstId],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        mediaId: firstId,
        localPath: "/uploads/imports/2026-07-27/first.png",
      }),
    ]);
  });

  it("rejects legacy imports rows that are not tool_input MediaAssets", async () => {
    const client = fakeClient();
    mocks.queryRaw.mockResolvedValue([
      row({
        originalKey: "/uploads/imports/2026-07-24/legacy.png",
        metadata: {},
      }),
    ]);

    await expect(
      inspectToolMediaInputs({
        client: client as never,
        ownerUserId: 7,
        toolMediaIds: [firstId],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("uses prepared model URLs for old single-source compatibility", async () => {
    const resolveLegacy = vi.fn(async (path: string) => `mapped:${path}`);
    const prepared = [row()].map((value) => ({
      mediaId: String(value.id),
      kind: String(value.kind),
      localPath: String(value.originalKey),
      position: 0,
      modelUrl: "https://prepared.example.com/first.png",
    }));

    await expect(
      resolveGenerationInputModelUrls({
        toolMediaInputs: prepared,
        legacyPaths: ["/uploads/legacy.png"],
        resolveLegacy,
      }),
    ).resolves.toEqual(["https://prepared.example.com/first.png"]);
    expect(resolveLegacy).not.toHaveBeenCalled();

    await expect(
      resolveGenerationInputModelUrls({
        toolMediaInputs: [],
        legacyPaths: ["/uploads/legacy.png"],
        resolveLegacy,
      }),
    ).resolves.toEqual(["mapped:/uploads/legacy.png"]);
    expect(resolveLegacy).toHaveBeenCalledTimes(1);
  });

  it("backfills and returns a missing objective probe for a Seedance tool input", async () => {
    const client = fakeClient();
    mocks.queryRaw.mockResolvedValue([row()]);
    mocks.mediaAssetUpdateMany.mockResolvedValueOnce({ count: 1 });

    const [input] = await inspectToolMediaInputs({
      client: client as never,
      ownerUserId: 7,
      toolMediaIds: [firstId],
      modelId: "doubao-seedance-2-0-260128",
    });

    expect(mocks.probeLocalMedia).toHaveBeenCalledWith({
      localPath: "C:/uploads/tool_inputs/2026-07-24/first.png",
      kind: "image",
      fileName: "first.png",
      declaredMime: "image/png",
    });
    expect(mocks.mediaAssetUpdateMany).toHaveBeenCalledWith({
      where: { id: firstId, status: "ready" },
      data: {
        detectedMime: "image/png",
        metadata: expect.objectContaining({
          origin: "tool_input",
          mediaProbe: expect.objectContaining({ width: 1280, height: 720 }),
        }),
      },
    });
    expect(input).toMatchObject({
      fileName: "first.png",
      byteSize: 1024,
      probe: expect.objectContaining({ width: 1280, height: 720 }),
    });
  });

  it("backfills and returns a missing objective probe for a MiniMax-H3 tool input", async () => {
    const client = fakeClient();
    mocks.queryRaw.mockResolvedValue([row()]);
    mocks.mediaAssetUpdateMany.mockResolvedValueOnce({ count: 1 });

    const [input] = await inspectToolMediaInputs({
      client: client as never,
      ownerUserId: 7,
      toolMediaIds: [firstId],
      modelId: "minimax-h3",
    });

    expect(mocks.probeLocalMedia).toHaveBeenCalledOnce();
    expect(input).toMatchObject({
      fileName: "first.png",
      byteSize: 1024,
      probe: expect.objectContaining({ width: 1280, height: 720 }),
    });
  });

  it("keeps MiniMax-H3 validation independent from the Seedance validation switch", async () => {
    const previous = process.env.SEEDANCE_MEDIA_VALIDATION_DISABLED;
    process.env.SEEDANCE_MEDIA_VALIDATION_DISABLED = "1";
    try {
      const client = fakeClient();
      mocks.queryRaw.mockResolvedValue([row()]);
      mocks.mediaAssetUpdateMany.mockResolvedValueOnce({ count: 1 });

      await inspectToolMediaInputs({
        client: client as never,
        ownerUserId: 7,
        toolMediaIds: [firstId],
        modelId: "minimax-h3",
      });

      expect(mocks.probeLocalMedia).toHaveBeenCalledOnce();
    } finally {
      if (previous === undefined) delete process.env.SEEDANCE_MEDIA_VALIDATION_DISABLED;
      else process.env.SEEDANCE_MEDIA_VALIDATION_DISABLED = previous;
    }
  });

  it("reuses a cached objective probe without running ffprobe or Sharp again", async () => {
    const client = fakeClient();
    const mediaProbe = {
      version: 1,
      kind: "image",
      detectedMime: "image/png",
      width: 1920,
      height: 1080,
    };
    mocks.queryRaw.mockResolvedValue([row({ metadata: { origin: "tool_input", mediaProbe } })]);

    const [input] = await inspectToolMediaInputs({
      client: client as never,
      ownerUserId: 7,
      toolMediaIds: [firstId],
      modelId: "doubao-seedance-2-0-260128",
    });

    expect(input.probe).toEqual(mediaProbe);
    expect(mocks.probeLocalMedia).not.toHaveBeenCalled();
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled();
  });

  it("resolves mixed inputs once and restores manifest order", async () => {
    const firstTool = {
      mediaId: firstId,
      kind: "image",
      localPath: "/uploads/tool_inputs/first.png",
      modelUrl: "https://model.example/tool-first.png",
      position: 0,
    };
    const secondTool = {
      mediaId: secondId,
      kind: "video",
      localPath: "/uploads/tool_inputs/second.mp4",
      modelUrl: "https://model.example/tool-second.mp4",
      position: 2,
    };

    await expect(
      resolveOrderedGenerationInputs({
        manifest: {
          version: 1,
          items: [
            { position: 0, source: "tool_media", mediaId: firstId },
            {
              position: 1,
              source: "legacy_path",
              path: "/uploads/product-library/legacy.png",
            },
            { position: 2, source: "tool_media", mediaId: secondId },
          ],
        },
        toolMediaInputs: [firstTool, secondTool],
        legacyInputs: [
          {
            manifestPath: "/uploads/product-library/legacy.png",
            kind: "image",
            localPath: "/uploads/imports/private-legacy.png",
            modelUrl: "https://model.example/legacy.png",
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        position: 0,
        source: "tool_media",
        modelUrl: firstTool.modelUrl,
      }),
      expect.objectContaining({
        position: 1,
        source: "legacy_path",
        localPath: "/uploads/imports/private-legacy.png",
        modelUrl: "https://model.example/legacy.png",
      }),
      expect.objectContaining({
        position: 2,
        source: "tool_media",
        modelUrl: secondTool.modelUrl,
      }),
    ]);
  });

  it("rejects mixed inputs without a manifest and missing provider URLs", async () => {
    await expect(
      resolveOrderedGenerationInputs({
        toolMediaInputs: [
          {
            mediaId: firstId,
            kind: "image",
            localPath: "/uploads/tool_inputs/first.png",
            modelUrl: "https://model.example/first.png",
            position: 0,
          },
        ],
        legacyInputs: [
          {
            manifestPath: "/uploads/legacy.png",
            kind: "image",
            localPath: "/uploads/legacy.png",
            modelUrl: "https://model.example/legacy.png",
          },
        ],
      }),
    ).rejects.toThrow("素材来源已混合但缺少顺序信息");

    await expect(
      resolveOrderedGenerationInputs({
        toolMediaInputs: [],
        legacyInputs: [
          {
            manifestPath: "/uploads/legacy.png",
            kind: "image",
            localPath: "/uploads/legacy.png",
            modelUrl: "",
          },
        ],
      }),
    ).rejects.toThrow("第 1 个素材无法提交给模型");
  });

  it.each([
    ["google-ai-studio", "oss"],
    ["google-ai-studio", "platform"],
    ["kie", "platform"],
  ])("uses the local path for %s in %s mode when the model URL is empty", async (platform, mode) => {
    vi.stubEnv("MEDIA_DELIVERY_MODE", mode);
    try {
      const client = fakeClient();
      mocks.buildAppPublicUploadUrl.mockReturnValue("");
      mocks.queryRaw.mockResolvedValue([row()]);
      const { inputs } = await createGenerationWithToolMedia({
        client: client as never,
        ownerUserId: 7,
        toolMediaIds: [firstId],
        role: "reference",
        mediaDeliveryTarget: { platform },
        createGeneration: async () => ({ id: 92 }),
      });
      expect(inputs).toEqual([expect.objectContaining({ mediaId: firstId, localPath: row().originalKey, modelUrl: row().originalKey })]);
      expect(mocks.resolveLocalUploadPathForExternalApiWithRelay).not.toHaveBeenCalled();
      expect(mocks.resolveOssObjectUrlForExternalApi).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rebuilds and records a relay URL from the local source inside the locked transaction", async () => {
    const client = fakeClient();
    mocks.buildAppPublicUploadUrl.mockReturnValue("");
    mocks.queryRaw.mockResolvedValue([row()]);
    mocks.mediaAssetUpdateMany.mockResolvedValue({ count: 1 });
    const createGeneration = vi.fn().mockResolvedValue({ id: 92 });

    const { inputs } = await createGenerationWithToolMedia({
      client: client as never,
      ownerUserId: 7,
      toolMediaIds: [firstId],
      role: "reference",
      createGeneration,
    });

    expect(inputs).toEqual([
      expect.objectContaining({
        mediaId: firstId,
        modelUrl:
          "https://oss.example.com/uploads/tool-input-relay/refreshed.png",
      }),
    ]);
    expect(
      mocks.resolveLocalUploadPathForExternalApiWithRelay,
    ).toHaveBeenCalledWith(
      "/uploads/tool_inputs/2026-07-24/first.png",
      "tool-input-relay",
    );
    expect(mocks.mediaAssetUpdateMany).toHaveBeenCalledWith({
      where: { id: firstId, status: "ready" },
      data: {
        variants: {
          relay: {
            objectKey: "uploads/tool-input-relay/refreshed.png",
            createdAt: expect.any(String),
          },
        },
      },
    });
  });

  it("keeps private relay URL work out of the unlocked preflight", async () => {
    const client = fakeClient();
    mocks.isOssPublicUrlConfigured.mockReturnValue(false);
    mocks.queryRaw.mockResolvedValue([
      row({
        variants: {
          relay: { objectKey: "uploads/tool-input-relay/existing.png" },
        },
      }),
    ]);

    await expect(
      inspectToolMediaInputs({
        client: client as never,
        ownerUserId: 7,
        toolMediaIds: [firstId],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        modelUrl: "",
        relayObjectKey: "uploads/tool-input-relay/existing.png",
      }),
    ]);
    expect(mocks.resolveOssObjectUrlForExternalApi).not.toHaveBeenCalled();
    expect(
      mocks.resolveLocalUploadPathForExternalApiWithRelay,
    ).not.toHaveBeenCalled();
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled();
  });

  it("signs a private relay inside the locked generation transaction", async () => {
    const client = fakeClient();
    mocks.isOssPublicUrlConfigured.mockReturnValue(false);
    mocks.queryRaw.mockResolvedValue([
      row({
        variants: {
          relay: { objectKey: "uploads/tool-input-relay/locked.png" },
        },
      }),
    ]);
    const createGeneration = vi.fn().mockResolvedValue({ id: 93 });

    await expect(
      createGenerationWithToolMedia({
        client: client as never,
        ownerUserId: 7,
        toolMediaIds: [firstId],
        role: "reference",
        createGeneration,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        inputs: [
          expect.objectContaining({
            modelUrl:
              "https://oss.example.com/uploads/tool-input-relay/signed.png?signature=fresh",
          }),
        ],
      }),
    );
    expect(createGeneration).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({
        modelUrl:
          "https://oss.example.com/uploads/tool-input-relay/signed.png?signature=fresh",
      }),
    ]);
  });

  it("deletes a rebuilt relay if the locked generation transaction rolls back", async () => {
    const client = fakeClient();
    mocks.buildAppPublicUploadUrl.mockReturnValue("");
    mocks.queryRaw.mockResolvedValue([row()]);
    mocks.mediaAssetUpdateMany.mockResolvedValue({ count: 1 });
    const createGeneration = vi.fn().mockRejectedValue(new Error("invalid model input"));

    await expect(createGenerationWithToolMedia({
      client: client as never,
      ownerUserId: 7,
      toolMediaIds: [firstId],
      role: "reference",
      createGeneration,
    })).rejects.toThrow("invalid model input");

    expect(mocks.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/tool-input-relay/refreshed.png",
    ]);
  });
});
