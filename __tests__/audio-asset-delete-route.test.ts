import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  userId: vi.fn(), findUnique: vi.fn(), computeRefs: vi.fn(), deleteStored: vi.fn(), deleteRows: vi.fn(),
  markDeleted: vi.fn(), retry: vi.fn(), retryIfNeeded: vi.fn(),
  tx: { log: { deleteMany: vi.fn() }, usageLedger: { deleteMany: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ default: {
  generation: { findUnique: mocks.findUnique }, $transaction: async (run: (tx: unknown) => unknown) => run(mocks.tx),
} }));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.userId }));
vi.mock("@/lib/admin-asset-feed", () => ({ markAdminAssetFeedDeleted: mocks.markDeleted }));
vi.mock("@/lib/media-cleanup", () => ({ computeDeletableRefsForGenerationIds: mocks.computeRefs, deleteStoredMediaRefs: mocks.deleteStored }));
vi.mock("@/lib/generation-physical-delete", () => ({ deleteGenerationRowsAndBatchCards: mocks.deleteRows }));
vi.mock("@/lib/media-cleanup-retry", () => ({ enqueueMediaCleanupRetry: mocks.retry, enqueueMediaCleanupRetryIfNeeded: mocks.retryIfNeeded }));
import { DELETE } from "@/app/api/assets/[id]/route";

describe("audio uses the existing owner asset deletion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId.mockResolvedValue(7);
    mocks.findUnique.mockResolvedValue({ id: 71, authUserId: 7, type: "audio_gen", localPath: "/uploads/canvas_audio_results/a.mp3" });
    mocks.computeRefs.mockResolvedValue(["/uploads/canvas_audio_results/a.mp3"]);
    mocks.deleteRows.mockResolvedValue({ generationOutputMediaIds: ["audio-media"] });
    mocks.markDeleted.mockResolvedValue(1);
    mocks.deleteStored.mockResolvedValue({ deletedLocalFiles: 1 });
    mocks.retry.mockResolvedValue(undefined);
  });
  const request = () => DELETE(new NextRequest("http://localhost/api/assets/71", { method: "DELETE" }), { params: { id: "71" } });

  it("enforces ownership before performing any deletion", async () => {
    mocks.userId.mockResolvedValue(8);
    expect((await request()).status).toBe(403);
    expect(mocks.computeRefs).not.toHaveBeenCalled();
    expect(mocks.deleteRows).not.toHaveBeenCalled();
  });
  it("uses reference protection, canonical cleanup and the existing administrator tombstone", async () => {
    expect((await request()).status).toBe(200);
    expect(mocks.computeRefs).toHaveBeenCalledWith([71]);
    expect(mocks.deleteRows).toHaveBeenCalledWith(mocks.tx, [71]);
    expect(mocks.markDeleted).toHaveBeenCalledWith([71]);
    expect(mocks.deleteStored).toHaveBeenCalledWith(["/uploads/canvas_audio_results/a.mp3"], {
      canonicalGenerationOutputs: true, canonicalGenerationMediaIds: ["audio-media"],
    });
  });
  it("queues audio storage failures for the normal cleanup retry", async () => {
    mocks.deleteStored.mockRejectedValueOnce(new Error("temporary failure"));
    expect((await request()).status).toBe(200);
    expect(mocks.retry).toHaveBeenCalledWith(["/uploads/canvas_audio_results/a.mp3"], expect.objectContaining({
      source: "asset_delete", generationIds: [71], error: "temporary failure",
    }));
  });
});
