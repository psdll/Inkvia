import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    $executeRaw: vi.fn(),
    toolWorkspaceDraft: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    toolWorkspaceDraftMedia: {
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    mediaAsset: {
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    client,
    transaction: vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client)),
    uploadToolMedia: vi.fn(),
    releaseToolMedia: vi.fn(),
    releaseOwnedUnreferencedToolMedia: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: { ...mocks.client, $transaction: mocks.transaction },
}));

vi.mock("@/lib/tool-media/service", () => ({
  uploadToolMedia: mocks.uploadToolMedia,
  releaseToolMedia: mocks.releaseToolMedia,
  releaseOwnedUnreferencedToolMedia: mocks.releaseOwnedUnreferencedToolMedia,
}));

import {
  detachToolWorkspaceMedia,
  getToolWorkspaceMediaUploadStatus,
  getToolWorkspaceDraft,
  saveToolWorkspaceDraft,
  uploadAndAttachToolWorkspaceMedia,
} from "@/lib/tool-workspace-draft/service";
import { normalizeToolWorkspaceTool } from "@/lib/tool-workspace-draft/contracts";

const draftId = "11111111-1111-4111-8111-111111111111";
const firstMediaId = "22222222-2222-4222-8222-222222222222";
const secondMediaId = "33333333-3333-4333-8333-333333333333";

function mediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(10),
    draftId,
    mediaId: firstMediaId,
    position: 0,
    slot: null,
    createdAt: new Date("2026-08-10T08:00:00.000Z"),
    media: {
      kind: "image",
      status: "ready",
      originalName: "reference.png",
      declaredMime: "image/png",
      sizeBytes: BigInt(1024),
      originalKey: "/uploads/imports/reference.png",
      createdAt: new Date("2026-08-10T07:59:00.000Z"),
    },
    ...overrides,
  };
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: draftId,
    authUserId: 7,
    tool: "image",
    schemaVersion: 1,
    payload: { schemaVersion: 1, tool: "image", state: { prompt: "跨浏览器" } },
    version: 1,
    createdAt: new Date("2026-08-10T08:00:00.000Z"),
    updatedAt: new Date("2026-08-10T08:01:00.000Z"),
    media: [],
    ...overrides,
  };
}

function pngFile() {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
    "reference.png",
    { type: "image/png" },
  );
}

describe("tool workspace draft service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (tx: typeof mocks.client) => unknown) => callback(mocks.client),
    );
    mocks.client.toolWorkspaceDraft.findUnique.mockResolvedValue(draftRow());
    mocks.client.$executeRaw.mockResolvedValue(1);
    mocks.client.toolWorkspaceDraft.create.mockResolvedValue(draftRow());
    mocks.client.toolWorkspaceDraft.update.mockResolvedValue({ version: 2 });
    mocks.client.toolWorkspaceDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.client.toolWorkspaceDraftMedia.create.mockResolvedValue(mediaRow());
    mocks.client.toolWorkspaceDraftMedia.createMany.mockResolvedValue({ count: 1 });
    mocks.client.toolWorkspaceDraftMedia.deleteMany.mockResolvedValue({ count: 0 });
    mocks.client.toolWorkspaceDraftMedia.findFirst.mockResolvedValue(null);
    mocks.client.toolWorkspaceDraftMedia.findMany.mockResolvedValue([]);
    mocks.client.mediaAsset.count.mockResolvedValue(0);
    mocks.client.mediaAsset.findFirst.mockResolvedValue(null);
    mocks.client.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    mocks.uploadToolMedia.mockResolvedValue({
      mediaId: firstMediaId,
      localPreviewUrl: "/uploads/imports/reference.png",
      modelUrl: "https://example.com/reference.png",
      status: "ready",
      kind: "image",
    });
    mocks.releaseToolMedia.mockResolvedValue({ releasedCount: 1 });
    mocks.releaseOwnedUnreferencedToolMedia.mockResolvedValue({ releasedCount: 1 });
  });

  it("accepts only the image and video workspaces", () => {
    expect(normalizeToolWorkspaceTool(" image ")).toBe("image");
    expect(normalizeToolWorkspaceTool("video")).toBe("video");
    expect(() => normalizeToolWorkspaceTool("face")).toThrowError(
      expect.objectContaining({ code: "TOOL_WORKSPACE_TOOL_INVALID" }),
    );
  });

  it("reads only the authenticated user's tool and restores media in position order", async () => {
    mocks.client.toolWorkspaceDraft.findUnique.mockResolvedValue(draftRow({
      media: [
        mediaRow({ id: BigInt(11), mediaId: secondMediaId, position: 1, slot: "last" }),
        mediaRow({ id: BigInt(10), mediaId: firstMediaId, position: 0, slot: "first" }),
      ],
    }));

    const draft = await getToolWorkspaceDraft({ authUserId: 7, tool: "image" });

    expect(mocks.client.toolWorkspaceDraft.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { authUserId_tool: { authUserId: 7, tool: "image" } },
    }));
    expect(draft?.media.map((item) => item.mediaId)).toEqual([firstMediaId, secondMediaId]);
    expect(draft?.media[0]).toMatchObject({ relationId: "10", sizeBytes: 1024 });
  });

  it("creates version one only for the authenticated user and tool", async () => {
    mocks.client.toolWorkspaceDraft.findUnique.mockResolvedValueOnce(null);
    mocks.client.toolWorkspaceDraft.create.mockResolvedValue(draftRow());

    const saved = await saveToolWorkspaceDraft({
      authUserId: 7,
      tool: "image",
      expectedVersion: 0,
      payload: { schemaVersion: 1, tool: "image", state: { prompt: "跨浏览器" } },
    });

    expect(saved.version).toBe(1);
    expect(mocks.client.toolWorkspaceDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authUserId: 7, tool: "image", version: 1 }),
    }));
  });

  it("returns a stable conflict when the expected version is stale", async () => {
    mocks.client.toolWorkspaceDraft.findUnique.mockResolvedValue(draftRow({
      tool: "video",
      version: 2,
      payload: { schemaVersion: 1, tool: "video", state: {} },
    }));
    mocks.client.toolWorkspaceDraft.updateMany.mockResolvedValue({ count: 0 });

    await expect(saveToolWorkspaceDraft({
      authUserId: 7,
      tool: "video",
      expectedVersion: 2,
      payload: { schemaVersion: 1, tool: "video", state: {} },
    })).rejects.toMatchObject({
      status: 409,
      code: "TOOL_WORKSPACE_DRAFT_VERSION_CONFLICT",
    });
  });

  it("rejects foreign media before replacing ordered relations", async () => {
    mocks.client.mediaAsset.count.mockResolvedValue(1);

    await expect(saveToolWorkspaceDraft({
      authUserId: 7,
      tool: "video",
      expectedVersion: 1,
      payload: { schemaVersion: 1, tool: "video", state: {} },
      media: [
        { mediaId: firstMediaId, position: 0, slot: "first" },
        { mediaId: secondMediaId, position: 1, slot: "last" },
      ],
    })).rejects.toMatchObject({ code: "TOOL_WORKSPACE_MEDIA_FORBIDDEN" });

    expect(mocks.client.toolWorkspaceDraftMedia.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects payloads over 64 KiB and invalid media slots", async () => {
    await expect(saveToolWorkspaceDraft({
      authUserId: 7,
      tool: "image",
      expectedVersion: 1,
      payload: { schemaVersion: 1, tool: "image", state: { prompt: "x".repeat(70 * 1024) } },
    })).rejects.toMatchObject({ code: "TOOL_WORKSPACE_PAYLOAD_TOO_LARGE" });

    await expect(saveToolWorkspaceDraft({
      authUserId: 7,
      tool: "video",
      expectedVersion: 1,
      payload: { schemaVersion: 1, tool: "video", state: {} },
      media: [{ mediaId: firstMediaId, position: 0, slot: "middle" as "first" }],
    })).rejects.toMatchObject({ code: "TOOL_WORKSPACE_MEDIA_SLOT_INVALID" });
  });

  it("attaches uploaded media to the owned draft and makes retention durable", async () => {
    mocks.client.toolWorkspaceDraftMedia.findFirst.mockResolvedValue({ position: 2 });
    mocks.client.toolWorkspaceDraftMedia.create.mockResolvedValue(mediaRow({ position: 3 }));

    const result = await uploadAndAttachToolWorkspaceMedia({
      authUserId: 7,
      tool: "image",
      file: pngFile(),
    });

    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7,
      draftSessionId: draftId,
    }));
    expect(mocks.client.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.client.toolWorkspaceDraftMedia.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { draftId, mediaId: firstMediaId, position: 3, slot: null },
    }));
    expect(mocks.client.mediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: firstMediaId, ownerUserId: 7 },
      data: { retentionUntil: null },
    });
    expect(result).toMatchObject({ version: 2, relation: { mediaId: firstMediaId } });
  });

  it("validates the file before returning an existing relation for the same request key", async () => {
    mocks.client.toolWorkspaceDraftMedia.findFirst.mockResolvedValue(mediaRow());

    const result = await uploadAndAttachToolWorkspaceMedia({
      authUserId: 7,
      tool: "image",
      file: pngFile(),
      requestKey: firstMediaId,
    });

    expect(result).toMatchObject({
      version: 1,
      relation: { relationId: "10", mediaId: firstMediaId, status: "ready" },
    });
    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: firstMediaId,
      file: expect.any(File),
    }));
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.client.toolWorkspaceDraft.update).not.toHaveBeenCalled();
  });

  it("rejects reuse of a request key with a different video frame slot", async () => {
    mocks.client.toolWorkspaceDraft.findUnique.mockResolvedValue(draftRow({ tool: "video" }));
    mocks.client.toolWorkspaceDraftMedia.findFirst.mockResolvedValue(mediaRow({ slot: "first" }));

    await expect(uploadAndAttachToolWorkspaceMedia({
      authUserId: 7,
      tool: "video",
      file: pngFile(),
      slot: "last",
      requestKey: firstMediaId,
    })).rejects.toMatchObject({
      status: 409,
      code: "TOOL_WORKSPACE_UPLOAD_REQUEST_KEY_CONFLICT",
    });
    expect(mocks.uploadToolMedia).toHaveBeenCalledOnce();
    expect(mocks.client.toolWorkspaceDraft.update).not.toHaveBeenCalled();
  });

  it("keeps a ready request-key asset recoverable when attachment fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(uploadAndAttachToolWorkspaceMedia({
      authUserId: 7,
      tool: "image",
      file: pngFile(),
      requestKey: firstMediaId,
    })).rejects.toThrow("database unavailable");

    expect(mocks.releaseToolMedia).not.toHaveBeenCalled();
  });

  it("serializes media position allocation for the whole draft", async () => {
    mocks.client.toolWorkspaceDraftMedia.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ position: 2 });

    await uploadAndAttachToolWorkspaceMedia({
      authUserId: 7,
      tool: "image",
      file: pngFile(),
      requestKey: firstMediaId,
    });

    expect(mocks.client.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.client.$executeRaw.mock.calls[0][0].values).toContain(
      `tool-workspace-upload:${draftId}`,
    );
    expect(mocks.client.$executeRaw.mock.calls[0][0].values).not.toContain(
      `tool-workspace-upload:${draftId}:${firstMediaId}`,
    );
    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: firstMediaId,
    }));
    expect(mocks.client.toolWorkspaceDraftMedia.create).toHaveBeenCalledOnce();
  });

  it("allocates distinct positions for different request keys under concurrent uploads", async () => {
    let transactionTail = Promise.resolve();
    const positions: number[] = [];
    let version = 1;
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.client) => unknown) => {
      const previous = transactionTail;
      let release: () => void = () => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(mocks.client);
      } finally {
        release();
      }
    });
    mocks.uploadToolMedia.mockImplementation(async (input: { mediaId?: string }) => ({
      mediaId: input.mediaId || firstMediaId,
      localPreviewUrl: "/uploads/imports/reference.png",
      modelUrl: "https://example.com/reference.png",
      status: "ready",
      kind: "image",
    }));
    mocks.client.toolWorkspaceDraftMedia.findFirst.mockImplementation(async (args: any) => {
      if (args.where?.mediaId) return null;
      return positions.length ? { position: Math.max(...positions) } : null;
    });
    mocks.client.toolWorkspaceDraftMedia.create.mockImplementation(async (args: any) => {
      positions.push(args.data.position);
      return mediaRow({
        id: BigInt(10 + positions.length),
        mediaId: args.data.mediaId,
        position: args.data.position,
      });
    });
    mocks.client.toolWorkspaceDraft.update.mockImplementation(async () => ({ version: ++version }));

    await Promise.all([
      uploadAndAttachToolWorkspaceMedia({
        authUserId: 7,
        tool: "image",
        file: pngFile(),
        requestKey: firstMediaId,
      }),
      uploadAndAttachToolWorkspaceMedia({
        authUserId: 7,
        tool: "image",
        file: pngFile(),
        requestKey: secondMediaId,
      }),
    ]);

    expect(positions).toEqual([0, 1]);
    expect(mocks.client.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.client.$executeRaw.mock.calls.map(([query]) => query.values)).toEqual([
      [`tool-workspace-upload:${draftId}`],
      [`tool-workspace-upload:${draftId}`],
    ]);
  });

  it("reports only an owned ready relation as a completed upload", async () => {
    mocks.client.toolWorkspaceDraftMedia.findFirst.mockResolvedValue(mediaRow());

    await expect(getToolWorkspaceMediaUploadStatus({
      authUserId: 7,
      tool: "image",
      requestKey: firstMediaId,
    })).resolves.toMatchObject({
      uploadState: "ready",
      version: 1,
      relation: { relationId: "10", mediaId: firstMediaId },
    });

    mocks.client.toolWorkspaceDraftMedia.findFirst.mockResolvedValue(null);
    mocks.client.mediaAsset.findFirst.mockResolvedValue(null);
    await expect(getToolWorkspaceMediaUploadStatus({
      authUserId: 7,
      tool: "image",
      requestKey: secondMediaId,
    })).resolves.toEqual({ uploadState: "pending" });
  });

  it("detaches only an owned relation and releases it after the relation is removed", async () => {
    mocks.client.toolWorkspaceDraftMedia.findFirst.mockResolvedValue({
      ...mediaRow(),
      draft: { id: draftId, authUserId: 7, tool: "video", version: 3 },
    });
    mocks.client.toolWorkspaceDraft.update.mockResolvedValue({ version: 4 });

    const result = await detachToolWorkspaceMedia({
      authUserId: 7,
      tool: "video",
      relationId: BigInt(10),
    });

    expect(mocks.client.toolWorkspaceDraftMedia.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: BigInt(10),
        draft: { authUserId: 7, tool: "video" },
      },
    }));
    expect(mocks.releaseOwnedUnreferencedToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      mediaIds: [firstMediaId],
    });
    expect(result).toEqual({ detached: true, released: true, version: 4 });
  });
});
