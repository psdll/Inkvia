import { describe, expect, it } from "vitest";
import {
  diffAdminWorkContributions,
  getAdminWorkFeedContribution,
} from "@/lib/admin-summary-projection";

const row = (overrides: Record<string, unknown> = {}) => ({
  generationId: 42,
  userId: "device-a",
  authUserId: 7,
  type: "image_edit",
  status: "pending",
  createdAt: new Date("2026-07-16T01:00:00.000Z"),
  sizeBytes64: BigInt(100),
  deletedAt: null,
  ...overrides,
});

describe("incremental admin summary projection", () => {
  it("maps one active work to one user and one daily bucket", () => {
    expect(getAdminWorkFeedContribution(row())).toEqual(expect.objectContaining({
      adminKey: "auth:7",
      bucketKey: "2026-07-16|auth:7",
      totalTaskCount: 1,
      successTaskCount: 0,
      failedTaskCount: 0,
      assetCount: 1,
      storageBytes: BigInt(100),
    }));
  });

  it("uses the Asia/Shanghai calendar day regardless of the Node process timezone", () => {
    expect(getAdminWorkFeedContribution(row({
      createdAt: new Date("2026-07-15T16:30:00.000Z"),
    }))?.day).toBe("2026-07-16");
  });

  it("changes pending to success without incrementing the lifetime task twice", () => {
    const diff = diffAdminWorkContributions(row(), row({ status: "success" }));

    expect(diff.summaries.get("auth:7")).toEqual(expect.objectContaining({
      totalTaskCount: 0,
      successTaskCount: 1,
      failedTaskCount: 0,
    }));
    expect(diff.daily.get("2026-07-16|auth:7")).toEqual(expect.objectContaining({
      generationCount: 0,
      successCount: 1,
    }));
  });

  it("subtracts the old identity and bucket when a work moves users or is deleted", () => {
    const moved = diffAdminWorkContributions(row(), row({ authUserId: 8, userId: "device-b" }));
    expect(moved.summaries.get("auth:7")?.totalTaskCount).toBe(-1);
    expect(moved.summaries.get("auth:8")?.totalTaskCount).toBe(1);

    const deleted = diffAdminWorkContributions(row({ status: "success" }), row({ status: "deleted", deletedAt: new Date() }));
    expect(deleted.summaries.get("auth:7")).toEqual(expect.objectContaining({
      totalTaskCount: -1,
      successTaskCount: -1,
      storageBytes: BigInt(-100),
    }));
  });

  it("does not count imports as generated assets or output types", () => {
    expect(getAdminWorkFeedContribution(row({ type: "import" }))).toEqual(expect.objectContaining({
      totalTaskCount: 1,
      assetCount: 0,
      imageCount: 0,
      otherCount: 0,
    }));
  });
});
