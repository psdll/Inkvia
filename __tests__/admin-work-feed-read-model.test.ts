import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRawUnsafe: vi.fn(),
  adminWorkFeed: {
    count: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
  generation: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  log: {
    findMany: vi.fn(),
  },
  imageBatchOutput: {
    findMany: vi.fn(),
  },
  liveVideoBatchOutput: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import {
  getAdminUserWorks,
  getAdminUserWorksChanges,
  isAdminWorksReadModelEnabled,
} from "@/lib/admin-user-works";

const scope = {
  generationWhere: { authUserId: 7 },
  logWhere: { userId: "device-a" },
};

const generation = {
  id: 42,
  userId: "device-a",
  authUserId: 7,
  type: "image_edit",
  source: "canvas",
  prompt: "test",
  model: "legacy-model",
  status: "processing",
  externalProvider: null,
  externalTaskId: null,
  errorMsg: null,
  localPath: "/uploads/image_results/original.png",
  templateData: null,
  createdAt: new Date("2026-07-16T00:00:00.000Z"),
  updatedAt: new Date("2026-07-16T00:01:00.000Z"),
  finishedAt: null,
};

const feed = {
  generationId: 42,
  sourceEventId: 12,
  userId: "device-a",
  authUserId: 7,
  type: "image_edit",
  status: "success",
  source: "canvas",
  provider: "provider-a",
  model: "feed-model",
  mediaKind: "image",
  thumbUrl: "/uploads/generation_previews/feed-grid.webp",
  previewUrl: null,
  displayUrl: null,
  posterUrl: null,
  errorMsg: null,
  createdAt: new Date("2026-07-16T00:00:00.000Z"),
  updatedAt: new Date("2026-07-16T00:02:00.000Z"),
  finishedAt: new Date("2026-07-16T00:02:00.000Z"),
  deletedAt: null,
};

describe("admin work feed read model flag", () => {
  beforeEach(() => {
    process.env.ADMIN_WORKS_READ_MODEL = "1";
    vi.clearAllMocks();
    prismaMock.adminWorkFeed.count.mockResolvedValue(1);
    prismaMock.adminWorkFeed.findMany.mockResolvedValue([feed]);
    prismaMock.adminWorkFeed.aggregate.mockResolvedValue({ _max: { sourceEventId: 12 } });
    prismaMock.adminWorkFeed.groupBy.mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ sourceEventId: 12 }]);
    prismaMock.generation.findMany.mockResolvedValue([generation]);
    prismaMock.log.findMany.mockResolvedValue([]);
    prismaMock.imageBatchOutput.findMany.mockResolvedValue([]);
    prismaMock.liveVideoBatchOutput.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.ADMIN_WORKS_READ_MODEL;
  });

  it("defaults to the legacy Generation query and only enables on an explicit 1", () => {
    expect(isAdminWorksReadModelEnabled({})).toBe(false);
    expect(isAdminWorksReadModelEnabled({ ADMIN_WORKS_READ_MODEL: "0" })).toBe(false);
    expect(isAdminWorksReadModelEnabled({ ADMIN_WORKS_READ_MODEL: "true" })).toBe(false);
    expect(isAdminWorksReadModelEnabled({ ADMIN_WORKS_READ_MODEL: "1" })).toBe(true);
  });

  it("serves ordering and display state from AdminWorkFeed when enabled", async () => {
    const result = await getAdminUserWorks({
      scope,
      page: 1,
      pageSize: 40,
      kind: "generated",
      typeFilter: "all",
      cursor: null,
    });

    expect(prismaMock.adminWorkFeed.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { generationId: "desc" }],
    }));
    expect(prismaMock.adminWorkFeed.count).not.toHaveBeenCalled();
    expect(prismaMock.generation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ authUserId: 7 }, { id: { in: [42] } }] },
    }));
    expect(result.generations[0]).toEqual(expect.objectContaining({
      id: 42,
      status: "success",
      model: "feed-model",
      thumbUrl: "/uploads/generation_previews/feed-grid.webp",
    }));
    expect(result.syncCursor).toEqual(expect.objectContaining({ sourceEventId: 12 }));
    expect(result.pagination.total).toBeNull();
  });

  it("recognizes historical audio even when its old feed row was classified as image", async () => {
    const localPath = "/uploads/canvas_audio_results/old.mp3";
    prismaMock.generation.findMany.mockResolvedValue([{ ...generation, type: "audio_gen", localPath }]);
    prismaMock.adminWorkFeed.findMany.mockResolvedValue([{ ...feed, type: "audio_gen", displayUrl: localPath, thumbUrl: localPath }]);
    const result = await getAdminUserWorks({ scope, page: 1, pageSize: 40, kind: "generated", typeFilter: "audio", cursor: null });
    expect(result.generations[0]).toMatchObject({ type: "audio_gen", displayKind: "audio", displayUrl: localPath, thumbUrl: null, previewUrl: null });
  });

  it("hydrates the concrete batch mode for administrator asset details", async () => {
    prismaMock.generation.findMany.mockResolvedValue([{ ...generation, source: "batch" }]);
    prismaMock.imageBatchOutput.findMany.mockResolvedValue([{
      generationId: 42,
      batch: { mode: "multi_prompt" },
    }]);

    const result = await getAdminUserWorks({
      scope,
      page: 1,
      pageSize: 40,
      kind: "generated",
      typeFilter: "all",
      cursor: null,
    });

    expect(result.generations[0].params).toMatchObject({
      batch: { mode: "multi_prompt" },
    });
  });

  it("hydrates the Live video batch mode for administrator asset details", async () => {
    prismaMock.generation.findMany.mockResolvedValue([{ ...generation, source: "tool" }]);
    prismaMock.adminWorkFeed.findMany.mockResolvedValue([{ ...feed, source: "tool" }]);
    prismaMock.liveVideoBatchOutput.findMany.mockResolvedValue([{ generationId: 42 }]);

    const result = await getAdminUserWorks({
      scope,
      page: 1,
      pageSize: 40,
      kind: "generated",
      typeFilter: "all",
      cursor: null,
    });

    expect(result.generations[0].params).toMatchObject({
      batch: { mode: "live_video" },
    });
    expect(result.generations[0].source).toBe("batch");
  });

  it("hydrates the saved original Skill prompt for administrator asset details", async () => {
    prismaMock.generation.findMany.mockResolvedValue([{
      ...generation,
      templateData: JSON.stringify({
        prompt: "Skill 生成的最终提示词",
        userPrompt: "用户原始提示词",
      }),
    }]);

    const result = await getAdminUserWorks({
      scope,
      page: 1,
      pageSize: 40,
      kind: "generated",
      typeFilter: "all",
      cursor: null,
    });

    expect(result.generations[0].params).toMatchObject({
      userPrompt: "用户原始提示词",
    });
  });

  it("preserves Generation display fields when an older feed row has no cached media URLs", async () => {
    prismaMock.adminWorkFeed.findMany.mockResolvedValue([{
      ...feed,
      thumbUrl: null,
      previewUrl: null,
      displayUrl: null,
      posterUrl: null,
    }]);

    const result = await getAdminUserWorks({
      scope,
      page: 1,
      pageSize: 40,
      kind: "generated",
      typeFilter: "all",
      cursor: null,
    });

    expect(result.generations[0]).toEqual(expect.objectContaining({
      displayUrl: "/uploads/image_results/original.png",
    }));
  });

  it("uses the global contiguous projection frontier for registered users", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([{ sourceEventId: 15 }]);

    const result = await getAdminUserWorks({
      scope: {
        authUserId: 7,
        linkedGuestUserIds: ["device-a", "device-b"],
        generationWhere: {
          OR: [
            { authUserId: 7 },
            { authUserId: null, userId: { in: ["device-a", "device-b"] } },
          ],
        },
        logWhere: { userId: { in: ["device-a", "device-b"] } },
      },
      page: 1,
      pageSize: 40,
      kind: "generated",
      typeFilter: "all",
      cursor: null,
    });

    expect(prismaMock.adminWorkFeed.aggregate).not.toHaveBeenCalled();
    expect(prismaMock.adminWorkFeed.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.adminWorkFeed.findMany).toHaveBeenCalledTimes(3);
    const branchQueries = JSON.stringify(prismaMock.adminWorkFeed.findMany.mock.calls);
    expect(branchQueries).toContain('"authUserId":7');
    expect(branchQueries).toContain('"authUserId":null');
    expect(branchQueries).toContain('"device-a"');
    expect(String(prismaMock.$queryRawUnsafe.mock.calls[0][0])).toContain('"status" <> \'done\'');
    expect(result.syncCursor).toEqual(expect.objectContaining({ sourceEventId: 15 }));
  });

  it("splits registered-user changes into indexable auth and guest branches", async () => {
    prismaMock.adminWorkFeed.findMany
      .mockResolvedValueOnce([{ ...feed, deletedAt: null }])
      .mockResolvedValueOnce([]);

    await getAdminUserWorksChanges({
      scope: {
        authUserId: 7,
        linkedGuestUserIds: ["device-a"],
        generationWhere: {
          OR: [
            { authUserId: 7 },
            { authUserId: null, userId: { in: ["device-a"] } },
          ],
        },
        logWhere: { userId: "device-a" },
      },
      sinceUpdatedAt: null,
      sinceId: null,
      sinceSourceEventId: 11,
      limit: 100,
      kind: "generated",
      typeFilter: "all",
    });

    expect(prismaMock.adminWorkFeed.findMany).toHaveBeenCalledTimes(2);
    const branchQueries = JSON.stringify(prismaMock.adminWorkFeed.findMany.mock.calls);
    expect(branchQueries).toContain('"authUserId":7');
    expect(branchQueries).toContain('"authUserId":null');
    expect(branchQueries).toContain('"sourceEventId":{"gt":11,"lte":12}');
  });

  it("uses the monotonic event cursor and emits tombstone ids even when updatedAt is unchanged", async () => {
    prismaMock.adminWorkFeed.findMany.mockResolvedValue([{
      ...feed,
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      deletedAt: new Date("2026-07-16T00:00:00.000Z"),
    }]);

    const result = await getAdminUserWorksChanges({
      scope,
      sinceUpdatedAt: "2026-07-16T00:00:00.000Z",
      sinceId: 0,
      sinceSourceEventId: 11,
      limit: 100,
      kind: "generated",
      typeFilter: "all",
    });

    expect(result.generations).toEqual([]);
    expect(result.deletedIds).toEqual([42]);
    expect(prismaMock.adminWorkFeed.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([{ sourceEventId: { gt: 11, lte: 12 } }]) }),
      orderBy: [{ sourceEventId: "asc" }, { generationId: "asc" }],
    }));
    expect(result.nextCursor).toEqual({
      updatedAt: "2026-07-16T00:00:00.000Z",
      id: 42,
      sourceEventId: 12,
    });
  });

  it("does not advance changes beyond a failed lower event", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([{ sourceEventId: 9 }]);
    prismaMock.adminWorkFeed.findMany.mockResolvedValue([]);

    const result = await getAdminUserWorksChanges({
      scope,
      sinceUpdatedAt: "2026-07-16T00:00:00.000Z",
      sinceId: 0,
      sinceSourceEventId: 5,
      limit: 100,
      kind: "generated",
      typeFilter: "all",
    });

    expect(prismaMock.adminWorkFeed.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([{ sourceEventId: { gt: 5, lte: 9 } }]) }),
    }));
    expect(result.nextCursor).toEqual(expect.objectContaining({ sourceEventId: 9 }));
  });
});
