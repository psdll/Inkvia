import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encodeHistoryCursor } from "@/lib/history/cursor";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  generationFindMany: vi.fn(),
  generationFindUnique: vi.fn(),
  generationUpdate: vi.fn(),
  generationCount: vi.fn(),
  generationInputMediaFindMany: vi.fn(),
  logFindMany: vi.fn(),
  pruneLogsIfNeeded: vi.fn(),
  finalizeGeneration: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    generation: {
      findMany: mocks.generationFindMany,
      findUnique: mocks.generationFindUnique,
      update: mocks.generationUpdate,
      count: mocks.generationCount,
    },
    generationInputMedia: {
      findMany: mocks.generationInputMediaFindMany,
    },
    log: { findMany: mocks.logFindMany },
  },
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/log-retention", () => ({ pruneLogsIfNeeded: mocks.pruneLogsIfNeeded }));
vi.mock("@/lib/generation/finalize", () => ({
  FINALIZE_PROVIDERS: ["mock-provider"],
  finalizeGeneration: mocks.finalizeGeneration,
  isInProgressStatus: (status: string) => ["running", "queued", "pending", "submitted", "processing"].includes(status),
}));
vi.mock("@/lib/generation-display-assets", () => ({
  getGenerationDisplayFields: ({ type, localPath }: { type?: string | null; localPath?: string | null }) => ({
    displayUrl: localPath || "",
    previewUrl: localPath || "",
    posterUrl: "",
    displayKind: type === "video_gen" || type === "video_generate" ? "video" : "image",
  }),
}));
vi.mock("@/lib/media-url", () => ({ normalizeMediaUrl: (value: string) => value }));

import { GET as getHistory } from "@/app/api/history/route";
import { GET as getHistorySummary } from "@/app/api/history/summary/route";

const firstId = "22222222-2222-4222-8222-222222222222";

function generationRow(id: number, createdAt: Date) {
  return {
    id,
    userId: "42",
    authUserId: 42,
    type: "image_edit",
    source: "tool",
    prompt: `prompt-${id}`,
    model: "model-a",
    status: "success",
    externalProvider: null,
    externalTaskId: null,
    requestKey: null,
    errorMsg: null,
    localPath: `/uploads/${id}.png`,
    templateData: "{}",
    createdAt,
    restoredAt: null,
    updatedAt: createdAt,
    finishedAt: createdAt,
    sizeBytes: null,
  };
}

describe("history performance API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(42);
    mocks.pruneLogsIfNeeded.mockResolvedValue(undefined);
    mocks.generationFindMany.mockResolvedValue([]);
    mocks.generationFindUnique.mockResolvedValue(null);
    mocks.generationUpdate.mockResolvedValue(null);
    mocks.generationCount.mockResolvedValue(0);
    mocks.generationInputMediaFindMany.mockResolvedValue([]);
    mocks.logFindMany.mockResolvedValue([]);
  });

  it("rejects compact status reads without an authenticated user", async () => {
    mocks.getUserId.mockResolvedValue(null);

    const response = await getHistory(new NextRequest("http://localhost/api/history?view=status&ids=7"));

    expect(response.status).toBe(401);
    expect(mocks.generationFindMany).not.toHaveBeenCalled();
  });

  it("keeps image results blank while the generated preview is still being saved", async () => {
    const updatedAt = new Date("2026-07-21T00:00:00.000Z");
    const remotePreviewUrl = "https://provider.test/preview.png";
    mocks.generationFindMany.mockResolvedValue([
      {
        id: 7,
        type: "image_edit",
        status: "running",
        localPath: null,
        errorMsg: null,
        updatedAt,
        externalProvider: null,
        requestKey: firstId,
        templateData: JSON.stringify({ phase: "saving", remotePreviewUrls: [remotePreviewUrl] }),
        createdAt: updatedAt,
      },
    ]);

    const response = await getHistory(
      new NextRequest("http://localhost/api/history?view=status&ids=7,9&type=image_edit&source=all"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: 7,
          type: "image_edit",
          status: "running",
          localPath: null,
          displayUrl: null,
          phase: "saving",
          errorMsg: null,
          requestKey: firstId,
          createdAt: updatedAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
    });
    expect(mocks.generationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        select: {
          id: true,
          type: true,
          status: true,
          localPath: true,
          errorMsg: true,
          updatedAt: true,
          externalProvider: true,
          requestKey: true,
          templateData: true,
          createdAt: true,
        },
      }),
    );
  });

  it("keeps the remote saving preview for video results", async () => {
    const updatedAt = new Date("2026-07-21T00:00:00.000Z");
    const remotePreviewUrl = "https://provider.test/preview.mp4";
    mocks.generationFindMany.mockResolvedValue([
      {
        id: 8,
        type: "video_gen",
        status: "running",
        localPath: null,
        errorMsg: null,
        updatedAt,
        externalProvider: null,
        requestKey: firstId,
        templateData: JSON.stringify({ phase: "saving", remotePreviewUrls: [remotePreviewUrl] }),
        createdAt: updatedAt,
      },
    ]);

    const response = await getHistory(
      new NextRequest("http://localhost/api/history?view=status&ids=8&type=video_gen&source=all"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: 8,
          displayUrl: remotePreviewUrl,
          phase: "saving",
        }),
      ],
    });
  });

  it("discovers only active tool tasks through the compact status view", async () => {
    const createdAt = new Date("2026-07-24T14:19:48.964Z");
    mocks.generationFindMany.mockResolvedValue([
      {
        id: 30142,
        type: "image_edit",
        status: "running",
        localPath: null,
        errorMsg: null,
        updatedAt: createdAt,
        externalProvider: null,
        requestKey: firstId,
        templateData: JSON.stringify({
          batch: {
            id: "batch-a",
            index: 2,
            size: 3,
            submittedAt: "2026-07-24T14:19:47.000Z",
          },
        }),
        createdAt,
      },
    ]);

    const response = await getHistory(
      new NextRequest("http://localhost/api/history?view=status&status=in_progress&source=tool"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: 30142,
          type: "image_edit",
          status: "running",
          localPath: null,
          displayUrl: null,
          phase: "generating",
          errorMsg: null,
          requestKey: firstId,
          batchId: "batch-a",
          batchIndex: 2,
          batchSize: 3,
          batchSubmittedAt: "2026-07-24T14:19:47.000Z",
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        },
      ],
    });
    expect(mocks.generationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            {
              AND: [
                { source: "tool" },
                { liveVideoBatchOutput: { is: null } },
              ],
            },
            {
              status: {
                in: ["running", "queued", "pending", "submitted", "processing"],
              },
            },
          ]),
        },
        take: 100,
        select: expect.objectContaining({
          requestKey: true,
          templateData: true,
        }),
      }),
    );
  });

  it("rejects a malformed cursor before querying history", async () => {
    const response = await getHistory(new NextRequest("http://localhost/api/history?status=all&cursor=broken"));

    expect(response.status).toBe(400);
    expect(mocks.generationFindMany).not.toHaveBeenCalled();
  });

  it("returns a stable next cursor while preserving full history fields", async () => {
    const rows = Array.from({ length: 51 }, (_, index) =>
      generationRow(100 - index, new Date(Date.UTC(2026, 6, 21, 12, 0, -index))),
    );
    mocks.generationFindMany.mockResolvedValue(rows);
    const cursor = encodeHistoryCursor({ createdAt: new Date("2026-07-21T13:00:00.000Z"), id: 101 });

    const response = await getHistory(
      new NextRequest(`http://localhost/api/history?status=all&withOutput=0&take=50&cursor=${cursor}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(50);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: 100, prompt: "prompt-100", params: {} }));
    expect(body.hasMore).toBe(true);
    expect(typeof body.nextCursor).toBe("string");
    expect(mocks.generationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 51,
      }),
    );
  });

  it("returns reusable input-media identities for image history templates", async () => {
    const createdAt = new Date("2026-07-24T03:00:00.000Z");
    mocks.generationFindMany.mockResolvedValue([
      {
        ...generationRow(30134, createdAt),
        templateData: JSON.stringify({
          imagePaths: ["/uploads/tool_inputs/2026-07-24/source.jpg"],
        }),
      },
    ]);
    mocks.generationInputMediaFindMany.mockResolvedValue([
      {
        generationId: 30134,
        mediaId: firstId,
        position: 0,
        role: "reference_image",
        media: {
          id: firstId,
          kind: "image",
          status: "ready",
          originalKey: "/uploads/tool_inputs/2026-07-24/source.jpg",
          publicUrl: null,
        },
      },
    ]);

    const response = await getHistory(
      new NextRequest("http://localhost/api/history?status=all&withOutput=0&take=50"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0].params.inputMedia).toEqual([
      {
        mediaId: firstId,
        status: "ready",
        localPreviewUrl: "/uploads/tool_inputs/2026-07-24/source.jpg",
        kind: "image",
        position: 0,
        role: "reference_image",
      },
    ]);
    expect(mocks.generationInputMediaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          generationId: { in: [30134] },
          media: expect.objectContaining({
            ownerUserId: 42,
            status: "ready",
            purgedAt: null,
          }),
        },
      }),
    );
  });

  it("can exclude import rows so each lazy page contains displayable task history", async () => {
    mocks.generationFindMany.mockResolvedValue([]);

    const response = await getHistory(
      new NextRequest("http://localhost/api/history?status=all&withOutput=0&take=50&source=tool&excludeImport=1"),
    );

    expect(response.status).toBe(200);
    expect(mocks.generationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            {
              AND: [
                { source: "tool" },
                { liveVideoBatchOutput: { is: null } },
              ],
            },
            { type: { not: "import" } },
          ]),
        },
      }),
    );
  });
});

describe("history summary authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(42);
    mocks.pruneLogsIfNeeded.mockResolvedValue(undefined);
    mocks.generationCount.mockResolvedValueOnce(3).mockResolvedValueOnce(9);
  });

  it("rejects unauthenticated summary reads", async () => {
    mocks.getUserId.mockResolvedValue(null);

    const response = await getHistorySummary(new NextRequest("http://localhost/api/history/summary?userId=someone-else"));

    expect(response.status).toBe(401);
    expect(mocks.generationCount).not.toHaveBeenCalled();
  });

  it("scopes counts to the authenticated identity instead of the query string", async () => {
    const response = await getHistorySummary(new NextRequest("http://localhost/api/history/summary?userId=someone-else"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inProgressCount: 3, completedCount: 9 });
    expect(mocks.generationCount).toHaveBeenCalledTimes(2);
    for (const [args] of mocks.generationCount.mock.calls) {
      expect(args.where).toEqual(
        expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { authUserId: 42 },
                { AND: [{ authUserId: null }, { userId: "42" }] },
              ],
            },
          ]),
        }),
      );
    }
  });
});
