import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    liveVideoBatch: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    liveVideoBatchItem: {
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    liveVideoPromptJob: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    liveVideoBatchOutput: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    mediaAsset: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  };
  return {
    client,
    transaction: vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client)),
    resolveRoleSkillForExecution: vi.fn(),
    getRegisteredProviders: vi.fn(),
    isProviderModelEnabled: vi.fn(),
    getVisibleToolboxModels: vi.fn(),
    uploadToolMedia: vi.fn(),
    releaseOwnedUnreferencedToolMedia: vi.fn(),
    releaseToolMedia: vi.fn(),
    importBatchProductLibrarySnapshot: vi.fn(),
    releaseBatchWorkspaceReference: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: { ...mocks.client, $transaction: mocks.transaction },
}));

vi.mock("@/lib/role-skills/repository", () => ({
  RoleSkillRepositoryError: class RoleSkillRepositoryError extends Error {},
  resolveRoleSkillForExecution: mocks.resolveRoleSkillForExecution,
}));

vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: mocks.getRegisteredProviders,
}));

vi.mock("@/lib/providers/model-availability", () => ({
  isProviderModelEnabled: mocks.isProviderModelEnabled,
}));

vi.mock("@/lib/image-edit-models", () => ({
  getVisibleToolboxModels: mocks.getVisibleToolboxModels,
}));

vi.mock("@/lib/tool-media/service", () => ({
  uploadToolMedia: mocks.uploadToolMedia,
  releaseOwnedUnreferencedToolMedia: mocks.releaseOwnedUnreferencedToolMedia,
  releaseToolMedia: mocks.releaseToolMedia,
}));

vi.mock("@/lib/batch-product-library/service", () => ({
  importBatchProductLibrarySnapshot: mocks.importBatchProductLibrarySnapshot,
  releaseBatchWorkspaceReference: mocks.releaseBatchWorkspaceReference,
}));

import {
  createLiveVideoBatch,
  detachLiveVideoDraftMedia,
  detachLiveVideoItemMedia,
  importLiveVideoBatchProductLibraryMedia,
  liveVideoDraftRequestKey,
  liveVideoEphemeralDraftRequestKey,
  listLiveVideoBatchStatuses,
  listLiveVideoBatches,
  normalizeLiveVideoSettings,
  submitLiveVideoBatch,
  uploadAndAttachLiveVideoDraftMedia,
  uploadAndAttachLiveVideoDraftMediaFiles,
  uploadAndReplaceLiveVideoItemMedia,
} from "@/lib/live-video-batch/service";

const batchId = "11111111-1111-4111-8111-111111111111";
const requestKey = "22222222-2222-4222-8222-222222222222";
const firstMediaId = "33333333-3333-4333-8333-333333333333";
const secondMediaId = "44444444-4444-4444-8444-444444444444";
const item1 = "55555555-5555-4555-8555-555555555555";
const item2 = "66666666-6666-4666-8666-666666666666";

function settings(overrides: Record<string, unknown> = {}) {
  return {
    model: "doubao-seedance-2-0-fast-260128",
    ratio: "9:16",
    resolution: "720p",
    duration: 9,
    generateAudio: false,
    ...overrides,
  };
}

function mediaRow(id: string, name: string) {
  return {
    id,
    ownerUserId: 7,
    kind: "image",
    status: "ready",
    originalName: name,
    declaredMime: "image/png",
    detectedMime: "image/png",
    originalKey: `/uploads/imports/${name}`,
    publicUrl: null,
  };
}

function aggregate(overrides: Record<string, unknown> = {}) {
  return {
    id: batchId,
    authUserId: 7,
    requestKey,
    name: "Live 视频分组",
    status: "prompt_queued",
    skillSnapshot: {
      publicId: "system:1",
      name: "商品动态设计",
      revision: 2,
      systemPrompt: "分析单张商品图并输出视频提示词",
    },
    sharedRequirement: "动作自然",
    videoSettings: normalizeLiveVideoSettings(settings()),
    version: 1,
    lastSubmissionKey: null,
    items: [],
    ...overrides,
  };
}

describe("live video batch service", () => {
  it("derives a different isolated workspace key for every document session", () => {
    const first = liveVideoEphemeralDraftRequestKey(
      7,
      "77777777-7777-4777-8777-777777777777",
    );
    const second = liveVideoEphemeralDraftRequestKey(
      7,
      "88888888-8888-4888-8888-888888888888",
    );

    expect(first).toMatch(/^e11d7a5f-/);
    expect(second).toMatch(/^e11d7a5f-/);
    expect(first).not.toBe(second);
    expect(first).not.toBe(liveVideoDraftRequestKey(7));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.liveVideoBatch.findUnique.mockResolvedValue(null);
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate());
    mocks.client.liveVideoBatch.updateMany.mockResolvedValue({ count: 1 });
    mocks.client.appSetting.findUnique.mockResolvedValue({
      key: "role_skill_binding.batch_workbench.live_video",
      value: JSON.stringify({ version: 1, skillPublicId: "system:1" }),
    });
    mocks.client.mediaAsset.findMany.mockResolvedValue([
      mediaRow(firstMediaId, "first.png"),
      mediaRow(secondMediaId, "second.png"),
    ]);
    mocks.client.mediaAsset.findFirst.mockResolvedValue(
      mediaRow(secondMediaId, "second.png"),
    );
    mocks.client.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    mocks.client.liveVideoBatchItem.updateMany.mockResolvedValue({ count: 1 });
    mocks.client.liveVideoBatchItem.count.mockResolvedValue(0);
    mocks.client.liveVideoBatchItem.findFirst.mockResolvedValue(null);
    mocks.uploadToolMedia.mockResolvedValue({
      mediaId: secondMediaId,
      status: "ready",
      kind: "image",
      localPreviewUrl: "/uploads/imports/second.png",
      modelUrl: "https://example.com/second.png",
    });
    mocks.releaseOwnedUnreferencedToolMedia.mockResolvedValue({ releasedCount: 1 });
    mocks.releaseToolMedia.mockResolvedValue({ releasedCount: 1 });
    mocks.importBatchProductLibrarySnapshot.mockImplementation(async (input: any) => {
      const attached = await input.adapter.attach(mocks.client, "product-snapshot");
      return { mediaId: "product-snapshot", ...attached };
    });
    mocks.releaseBatchWorkspaceReference.mockImplementation(async (_tx: unknown, input: any) => {
      return !(await input.hasBusinessReference());
    });
    mocks.resolveRoleSkillForExecution.mockResolvedValue({
      source: "system",
      id: BigInt(1),
      name: "商品动态设计",
      revision: 2,
      content: "分析单张商品图并输出视频提示词",
    });
    mocks.getRegisteredProviders.mockResolvedValue([{ id: "volcengine" }]);
    mocks.isProviderModelEnabled.mockReturnValue(true);
    mocks.getVisibleToolboxModels.mockResolvedValue([{
      id: "doubao-seedance-2-0-fast-260128",
      supportedResolutions: ["480p", "720p"],
    }]);
  });

  it("accepts a supported non-default duration and rejects an unsupported duration", () => {
    expect(normalizeLiveVideoSettings(settings()).duration).toBe(9);
    expect(() => normalizeLiveVideoSettings(settings({ duration: 16 }))).toThrow(
      expect.objectContaining({ code: "LIVE_VIDEO_DURATION_INVALID" }),
    );
  });

  it("always normalizes Live batches to multimodal", () => {
    expect(normalizeLiveVideoSettings(settings({ inputMode: "multimodal" })).inputMode).toBe("multimodal");
    expect(normalizeLiveVideoSettings(settings({ inputMode: "first_frame" })).inputMode).toBe("multimodal");
    expect(normalizeLiveVideoSettings(settings({ inputMode: "first_last_frame" })).inputMode).toBe("multimodal");
  });

  it("loads five history groups with a stable cursor and only the latest attempts", async () => {
    const rows = Array.from({ length: 6 }, (_, index) => aggregate({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      createdAt: new Date(`2026-08-${String(12 - index).padStart(2, "0")}T00:00:00.000Z`),
    }));
    mocks.client.liveVideoBatch.findMany.mockResolvedValue(rows);

    const result = await listLiveVideoBatches({ authUserId: 7 });

    expect(result.batches).toEqual(rows.slice(0, 5));
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(mocks.client.liveVideoBatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 6,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: expect.objectContaining({
        items: expect.objectContaining({
          select: expect.objectContaining({
            promptJobs: expect.objectContaining({ take: 1 }),
            outputs: expect.objectContaining({ take: 1 }),
          }),
        }),
      }),
    }));
    const historyQuery = mocks.client.liveVideoBatch.findMany.mock.calls.at(-1)?.[0];
    expect(historyQuery.where).toEqual(expect.objectContaining({
      status: { not: "draft" },
    }));
    expect(JSON.stringify(historyQuery.where)).not.toContain("startsWith");
  });

  it("polls only explicitly active Live groups with the slim history shape", async () => {
    mocks.client.liveVideoBatch.findMany.mockResolvedValue([aggregate()]);

    await listLiveVideoBatchStatuses({ authUserId: 7, batchIds: [batchId] });

    expect(mocks.client.liveVideoBatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: [batchId] },
        status: { not: "draft" },
      }),
      select: expect.objectContaining({
        items: expect.objectContaining({
          select: expect.objectContaining({
            promptJobs: expect.objectContaining({ take: 1 }),
            outputs: expect.objectContaining({ take: 1 }),
          }),
        }),
      }),
    }));
    const statusQuery = mocks.client.liveVideoBatch.findMany.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(statusQuery.where)).not.toContain("startsWith");
  });

  it("creates one item and one independent prompt job per image", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      items: [
        {
          id: item1,
          position: 0,
          sourceMediaId: firstMediaId,
          sourceMedia: mediaRow(firstMediaId, "first.png"),
          promptJobs: [],
          outputs: [],
        },
        {
          id: item2,
          position: 1,
          sourceMediaId: secondMediaId,
          sourceMedia: mediaRow(secondMediaId, "second.png"),
          promptJobs: [],
          outputs: [],
        },
      ],
    }));
    await createLiveVideoBatch({
      authUserId: 7,
      requestKey,
      name: "Live 视频分组",
      skillPublicId: "system:1",
      sharedRequirement: "动作自然",
      videoSettings: settings(),
      sourceBatchId: batchId,
    });

    const itemData = mocks.client.liveVideoBatchItem.createMany.mock.calls[0][0].data;
    const promptData = mocks.client.liveVideoPromptJob.createMany.mock.calls[0][0].data;
    expect(itemData).toHaveLength(2);
    expect(promptData).toHaveLength(2);
    expect(new Set(promptData.map((job: any) => job.itemId)).size).toBe(2);
    expect(promptData.map((job: any) => job.mediaSnapshot.mediaId)).toEqual([
      firstMediaId,
      secondMediaId,
    ]);
    expect(promptData.every((job: any) => !Array.isArray(job.mediaSnapshot))).toBe(true);
  });

  it("uses the administrator-bound Live system Skill when the user has no override", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      items: [{
        id: item1,
        position: 0,
        sourceMediaId: firstMediaId,
        sourceMedia: mediaRow(firstMediaId, "first.png"),
        promptJobs: [],
        outputs: [],
      }],
    }));

    await createLiveVideoBatch({
      authUserId: 7,
      requestKey,
      skillPublicId: undefined,
      sharedRequirement: "动作自然",
      videoSettings: settings(),
      sourceBatchId: batchId,
    });

    expect(mocks.resolveRoleSkillForExecution).toHaveBeenCalledWith({
      authUserId: 7,
      publicId: "system:1",
    });
  });

  it("rejects an eleven-image group before resolving the skill or model", async () => {
    const mediaIds = Array.from({ length: 11 }, (_, index) =>
      `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`,
    );
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      items: mediaIds.map((mediaId, position) => ({
        id: crypto.randomUUID(),
        position,
        sourceMediaId: mediaId,
        sourceMedia: mediaRow(mediaId, `${position + 1}.png`),
        promptJobs: [],
        outputs: [],
      })),
    }));
    await expect(createLiveVideoBatch({
      authUserId: 7,
      requestKey,
      skillPublicId: "system:1",
      videoSettings: settings(),
      sourceBatchId: batchId,
    })).rejects.toMatchObject({
      code: "LIVE_VIDEO_MEDIA_LIMIT",
      status: 400,
    });
    expect(mocks.resolveRoleSkillForExecution).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns the owned batch for an idempotent create request", async () => {
    mocks.client.liveVideoBatch.findUnique.mockResolvedValue(aggregate());
    const result = await createLiveVideoBatch({
      authUserId: 7,
      requestKey,
      skillPublicId: "system:1",
      videoSettings: settings(),
      sourceBatchId: batchId,
    });
    expect(result.id).toBe(batchId);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("freezes multimodal and selected-duration settings into every submitted task", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      status: "ready",
      items: [
        {
          id: item1,
          name: "任务 1",
          sourceMediaId: firstMediaId,
          mediaSnapshot: {
            mediaId: firstMediaId,
            mediaPath: "/uploads/imports/first.png",
          },
          prompt: "镜头缓慢推进",
          promptStatus: "prompt_ready",
          outputs: [],
        },
        {
          id: item2,
          name: "任务 2",
          sourceMediaId: secondMediaId,
          mediaSnapshot: {
            mediaId: secondMediaId,
            mediaPath: "/uploads/imports/second.png",
          },
          prompt: "产品轻微旋转",
          promptStatus: "prompt_ready",
          outputs: [],
        },
      ],
    }));

    await submitLiveVideoBatch({
      authUserId: 7,
      batchId,
      submissionKey: "88888888-8888-4888-8888-888888888888",
      itemRequestKeys: {
        [item1]: "99999999-9999-4999-8999-999999999991",
        [item2]: "99999999-9999-4999-8999-999999999992",
      },
    });

    const outputs = mocks.client.liveVideoBatchOutput.createMany.mock.calls[0][0].data;
    expect(outputs).toHaveLength(2);
    for (const output of outputs) {
      expect(output.requestSnapshot).toMatchObject({
        inputMode: "multimodal",
        duration: 9,
        model: "doubao-seedance-2-0-fast-260128",
        userPrompt: "动作自然",
      });
    }
    expect(outputs.map((output: any) => output.requestSnapshot.prompt)).toEqual([
      "镜头缓慢推进",
      "产品轻微旋转",
    ]);
    expect(outputs.map((output: any) => output.requestSnapshot.sourceMediaId)).toEqual([
      firstMediaId,
      secondMediaId,
    ]);
  });

  it("uploads and atomically replaces one task source image", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      status: "ready",
      version: 3,
      items: [{
        id: item1,
        sourceMediaId: firstMediaId,
        mediaSnapshot: { mediaId: firstMediaId },
        prompt: "保留当前提示词",
        promptStatus: "prompt_ready",
        outputs: [],
        promptJobs: [],
      }],
    }));
    const file = Object.assign(new Blob(["image"], { type: "image/png" }), {
      name: "second.png",
    }) as File;

    await uploadAndReplaceLiveVideoItemMedia({
      authUserId: 7,
      batchId,
      itemId: item1,
      expectedVersion: 3,
      draftSessionId: "live-item-upload",
      file,
    });

    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7,
      draftSessionId: "live-item-upload",
      storageProfile: "batch",
      modelId: "doubao-seedance-2-0-fast-260128",
      allowedKinds: ["image"],
      maxBytes: { image: 30 * 1024 * 1024 },
      allowedMimeTypes: expect.arrayContaining(["image/tiff", "image/heic", "image/heif"]),
    }));
    expect(mocks.client.liveVideoBatchItem.updateMany).toHaveBeenCalledWith({
      where: { id: item1, batchId },
      data: expect.objectContaining({
        sourceMediaId: secondMediaId,
        mediaSnapshot: expect.objectContaining({ mediaId: secondMediaId }),
        videoStatus: "draft",
      }),
    });
    expect(mocks.releaseOwnedUnreferencedToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      mediaIds: [firstMediaId],
    });
  });

  it("imports a product-library snapshot into the isolated Live draft", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      version: 2,
      items: [],
    }));
    mocks.client.liveVideoBatchItem.create.mockResolvedValue({ id: item1 });

    await importLiveVideoBatchProductLibraryMedia({
      authUserId: 7,
      batchId,
      productLibraryItemId: 12,
      requestKey: "77777777-7777-4777-8777-777777777777",
      expectedVersion: 2,
    });

    expect(mocks.importBatchProductLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      authUserId: 7,
      batchId,
      productLibraryItemId: 12,
      requestKey: "77777777-7777-4777-8777-777777777777",
      adapter: expect.objectContaining({
        modeKey: "live_video_batch",
        sourceId: `live_video_batch:${batchId}`,
      }),
    }));
    expect(mocks.client.liveVideoBatchItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchId,
        position: 0,
        sourceMediaId: "product-snapshot",
        promptStatus: "draft",
        videoStatus: "draft",
      }),
    });
  });

  it("reuses the same Live draft item when a product-library request is retried at the limit", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      version: 2,
      items: Array.from({ length: 10 }, (_, position) => ({
        id: `00000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
        position,
        sourceMediaId: position === 0 ? "product-snapshot" : firstMediaId,
        outputs: [],
        promptJobs: [],
      })),
    }));
    mocks.client.liveVideoBatchItem.findFirst.mockResolvedValueOnce({ id: item1 });

    await importLiveVideoBatchProductLibraryMedia({
      authUserId: 7,
      batchId,
      productLibraryItemId: 12,
      requestKey: "77777777-7777-4777-8777-777777777777",
      expectedVersion: 2,
    });

    expect(mocks.client.liveVideoBatchItem.count).not.toHaveBeenCalled();
    expect(mocks.client.liveVideoBatchItem.create).not.toHaveBeenCalled();
    expect(mocks.client.liveVideoBatch.updateMany).not.toHaveBeenCalled();
  });

  it("replaces one Live task with a product snapshot and releases the old workspace reference", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      status: "ready",
      version: 3,
      items: [{
        id: item1,
        sourceMediaId: firstMediaId,
        sourceMedia: mediaRow(firstMediaId, "first.png"),
        mediaSnapshot: { mediaId: firstMediaId },
        prompt: "保留当前提示词",
        promptStatus: "prompt_ready",
        outputs: [],
        promptJobs: [],
      }],
    }));
    mocks.client.liveVideoBatchItem.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: item1,
        sourceMediaId: firstMediaId,
        sourceMedia: mediaRow(firstMediaId, "first.png"),
      });

    await importLiveVideoBatchProductLibraryMedia({
      authUserId: 7,
      batchId,
      itemId: item1,
      productLibraryItemId: 12,
      requestKey: "77777777-7777-4777-8777-777777777777",
      expectedVersion: 3,
    });

    expect(mocks.client.liveVideoBatchItem.updateMany).toHaveBeenCalledWith({
      where: { id: item1, batchId },
      data: expect.objectContaining({
        sourceMediaId: "product-snapshot",
        videoStatus: "draft",
      }),
    });
    expect(mocks.releaseBatchWorkspaceReference).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        mediaId: firstMediaId,
        sourceId: `live_video_batch:${batchId}`,
      }),
    );
    expect(mocks.releaseOwnedUnreferencedToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      mediaIds: [firstMediaId],
    });
  });

  it("uploads left-side draft media through batch storage and creates a Live draft item", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      version: 2,
      items: [],
    }));
    const file = Object.assign(new Blob(["image"], { type: "image/png" }), {
      name: "first.png",
    }) as File;

    await uploadAndAttachLiveVideoDraftMedia({
      authUserId: 7,
      batchId,
      expectedVersion: 2,
      draftSessionId: "live-draft-upload",
      file,
    });

    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7,
      draftSessionId: "live-draft-upload",
      storageProfile: "batch",
      metadata: { batchId },
      modelId: "doubao-seedance-2-0-fast-260128",
      allowedKinds: ["image"],
      maxBytes: { image: 30 * 1024 * 1024 },
      allowedMimeTypes: expect.arrayContaining(["image/tiff", "image/heic", "image/heif"]),
    }));
    expect(mocks.client.liveVideoBatchItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchId,
        position: 0,
        sourceMediaId: secondMediaId,
        promptStatus: "draft",
        videoStatus: "draft",
      }),
    });
  });

  it("attaches a Live upload batch with one version check and ordered positions", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      version: 2,
      items: [],
    }));
    mocks.uploadToolMedia.mockImplementation(async ({ file }: { file: File }) => ({
      mediaId: file.name === "first.png" ? firstMediaId : secondMediaId,
      status: "ready",
      kind: "image",
    }));
    const files = [
      Object.assign(new Blob(["one"], { type: "image/png" }), { name: "first.png" }) as File,
      Object.assign(new Blob(["two"], { type: "image/png" }), { name: "second.png" }) as File,
    ];

    await uploadAndAttachLiveVideoDraftMediaFiles({
      authUserId: 7,
      batchId,
      expectedVersion: 2,
      draftSessionId: "live-draft-upload",
      files,
    });

    expect(mocks.uploadToolMedia).toHaveBeenCalledTimes(2);
    expect(mocks.client.liveVideoBatch.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.client.liveVideoBatchItem.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ sourceMediaId: firstMediaId, position: 0 }),
    });
    expect(mocks.client.liveVideoBatchItem.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ sourceMediaId: secondMediaId, position: 1 }),
    });
    expect(mocks.client.mediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [firstMediaId, secondMediaId] }, ownerUserId: 7 },
      data: { retentionUntil: null },
    });
  });

  it("releases completed Live uploads when the same request has a failed file", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      version: 2,
      items: [],
    }));
    mocks.uploadToolMedia.mockImplementation(async ({ file }: { file: File }) => {
      if (file.name === "broken.png") throw new Error("文件损坏");
      return { mediaId: firstMediaId, status: "ready", kind: "image" };
    });

    await expect(uploadAndAttachLiveVideoDraftMediaFiles({
      authUserId: 7,
      batchId,
      expectedVersion: 2,
      draftSessionId: "live-draft-upload",
      files: [
        Object.assign(new Blob(["ready"], { type: "image/png" }), { name: "ready.png" }) as File,
        Object.assign(new Blob(["broken"], { type: "image/png" }), { name: "broken.png" }) as File,
      ],
    })).rejects.toThrow("broken.png：文件损坏");

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.releaseToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      draftSessionId: "live-draft-upload",
      mediaIds: [firstMediaId],
    });
  });

  it("deletes a left-side draft item and releases only an unreferenced asset", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      requestKey: liveVideoDraftRequestKey(7),
      status: "draft",
      version: 3,
      items: [{
        id: item1,
        position: 0,
        sourceMediaId: firstMediaId,
        mediaSnapshot: { mediaId: firstMediaId },
        sourceMedia: mediaRow(firstMediaId, "first.png"),
        promptJobs: [],
        outputs: [],
      }],
    }));

    await detachLiveVideoDraftMedia({
      authUserId: 7,
      batchId,
      itemId: item1,
      expectedVersion: 3,
    });

    expect(mocks.client.liveVideoBatchItem.delete).toHaveBeenCalledWith({
      where: { id: item1 },
    });
    expect(mocks.releaseOwnedUnreferencedToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      mediaIds: [firstMediaId],
    });
  });

  it("detaches a task image into a saved no-image draft state", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      status: "ready",
      version: 4,
      items: [{
        id: item1,
        sourceMediaId: firstMediaId,
        mediaSnapshot: { mediaId: firstMediaId },
        prompt: "保留当前提示词",
        promptStatus: "prompt_ready",
        outputs: [],
        promptJobs: [],
      }],
    }));

    await detachLiveVideoItemMedia({
      authUserId: 7,
      batchId,
      itemId: item1,
      expectedVersion: 4,
    });

    expect(mocks.client.liveVideoBatchItem.updateMany).toHaveBeenCalledWith({
      where: { id: item1, batchId },
      data: expect.objectContaining({
        sourceMediaId: null,
        mediaSnapshot: {},
        videoStatus: "draft",
      }),
    });
    expect(mocks.releaseOwnedUnreferencedToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      mediaIds: [firstMediaId],
    });
  });

  it("rejects video submission when a task has no source image", async () => {
    mocks.client.liveVideoBatch.findFirst.mockResolvedValue(aggregate({
      status: "ready",
      items: [{
        id: item1,
        name: "任务 1",
        sourceMediaId: null,
        mediaSnapshot: {},
        prompt: "镜头缓慢推进",
        promptStatus: "prompt_ready",
        outputs: [],
      }],
    }));

    await expect(submitLiveVideoBatch({
      authUserId: 7,
      batchId,
      submissionKey: "88888888-8888-4888-8888-888888888888",
      itemRequestKeys: {
        [item1]: "99999999-9999-4999-8999-999999999991",
      },
    })).rejects.toMatchObject({
      code: "LIVE_VIDEO_MEDIA_REQUIRED",
      status: 400,
    });
    expect(mocks.client.liveVideoBatchOutput.createMany).not.toHaveBeenCalled();
  });
});
