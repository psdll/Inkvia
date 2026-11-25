import { describe, expect, it } from "vitest";

import { buildAdminStorageAnalytics } from "@/lib/admin-storage-read-model";

describe("admin storage read model analytics", () => {
  it("uses the 90-day rollup for production and summaries for lifetime totals", () => {
    const analytics = buildAdminStorageAnalytics({
      days: 90,
      totalBytes: 1_000,
      summaries: [{
        adminKey: "auth:7",
        userId: "7",
        authUserId: 7,
        username: "Alice",
        totalTaskCount: 20,
        assetCount: 18,
        storageBytes: BigInt(700),
        lastActiveAt: new Date("2026-07-16T08:00:00.000Z"),
      }],
      modelUsageRows: [{
        day: "2026-07-16",
        authUserId: 7,
        userId: "7",
        model: "model-a",
        requestCount: 4,
        successCount: 3,
        failedCount: 1,
      }],
      rollup: {
        daily: [{
          day: "2026-07-16",
          generationCount: 5,
          successCount: 3,
          failedCount: 1,
          storageBytes: 100,
          imageCount: 2,
          videoCount: 1,
          faceCount: 0,
          otherCount: 1,
        }],
        perUser: [{
          authUserId: 7,
          userId: "7",
          generationCount: 5,
          successCount: 3,
          failedCount: 1,
          storageBytes: 100,
          imageCount: 2,
          videoCount: 1,
          faceCount: 0,
          otherCount: 1,
          daily: new Map([["2026-07-16", 4]]),
        }],
        totals: {
          generationCount: 5,
          successCount: 3,
          failedCount: 1,
          storageBytes: 100,
          imageCount: 2,
          videoCount: 1,
          faceCount: 0,
          otherCount: 1,
        },
      },
    });

    expect(analytics.totals.totalGenerations).toBe(4);
    expect(analytics.totals.lifetimeGenerations).toBe(18);
    expect(analytics.users[0]).toEqual(expect.objectContaining({
      adminKey: "auth:7",
      generationCount: 4,
      storageBytes: 700,
      storageShare: 0,
    }));
    expect(analytics.modelUsage.globalModelRatio).toEqual([
      { model: "model-a", count: 4, ratio: 1 },
    ]);
    expect(analytics.modelUsage.modelOutcomeTop[0]).toEqual(expect.objectContaining({
      model: "model-a",
      totalCalls: 4,
      successRate: 0.75,
    }));
  });

  it("marks low ownership coverage incomplete and avoids misleading shares", () => {
    const analytics = buildAdminStorageAnalytics({
      days: 90,
      totalBytes: 1_000,
      summaries: [{
        adminKey: "guest:device-a",
        userId: "device-a",
        authUserId: null,
        username: null,
        totalTaskCount: 2,
        assetCount: 2,
        storageBytes: BigInt(200),
        lastActiveAt: null,
      }],
      rollup: {
        daily: [],
        perUser: [],
        totals: {
          generationCount: 0,
          successCount: 0,
          failedCount: 0,
          storageBytes: 0,
          imageCount: 0,
          videoCount: 0,
          faceCount: 0,
          otherCount: 0,
        },
      },
    });

    expect(analytics.capacityOwnership).toEqual({
      attributedBytes: 200,
      totalBytes: 1_000,
      coverage: 0.2,
      complete: false,
    });
    expect(analytics.users[0].storageShare).toBe(0);
    expect(analytics.insights).toContain("用户容量归属率仅 20.0%，低于 80%，已隐藏用户容量占比。");
  });

  it("preserves behavior, failure, type-size and private material analytics from server data", () => {
    const now = new Date();
    const analytics = buildAdminStorageAnalytics({
      days: 90,
      totalBytes: 1_000,
      summaries: [{
        adminKey: "auth:7",
        userId: "7",
        authUserId: 7,
        username: "Alice",
        totalTaskCount: 4,
        assetCount: 4,
        storageBytes: BigInt(700),
        lastActiveAt: now,
      }],
      rollup: {
        daily: [{
          day: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(now),
          generationCount: 4,
          successCount: 3,
          failedCount: 1,
          storageBytes: 700,
          imageCount: 4,
          videoCount: 0,
          faceCount: 0,
          otherCount: 0,
        }],
        perUser: [],
        totals: {
          generationCount: 4,
          successCount: 3,
          failedCount: 1,
          storageBytes: 700,
          imageCount: 4,
          videoCount: 0,
          faceCount: 0,
          otherCount: 0,
        },
      },
      behaviorRows: [
        { category: "user_action", action: "upload_input", createdAt: now },
        { category: "user_action", action: "download_output", createdAt: now },
        { category: "user_action", action: "delete_output", createdAt: now },
        { category: "generation", action: "task_create", createdAt: now },
      ],
      failureRows: [{ type: "image_edit", errorMsg: "provider timeout" }],
      privateMediaRows: [{ ownerUserId: 7, kind: "image", count: 2, storageBytes: 300 }],
      typeStorageRows: [{ type: "image_edit", storageBytes: 700 }],
      unknownStorageCount: 2,
    });

    expect(analytics.capacityOwnership).toEqual({
      attributedBytes: 1_000,
      totalBytes: 1_000,
      coverage: 1,
      complete: true,
    });
    expect(analytics.users[0]).toEqual(expect.objectContaining({ storageBytes: 1_000, storageShare: 1 }));
    expect(analytics.totals.unknownStorageCount).toBe(2);
    expect(analytics.behavior.funnel).toEqual({
      upload: 1,
      submit: 1,
      success: 3,
      failed: 1,
      download: 1,
      delete: 1,
    });
    expect(analytics.behavior.failureByType).toContainEqual({ type: "image", count: 1 });
    expect(analytics.behavior.failureByReasonTop).toContainEqual({ reason: "provider timeout", count: 1 });
    expect(analytics.typeDistribution).toContainEqual({ type: "image", generationCount: 4, storageBytes: 1_000 });
    expect(analytics.userMaterialRatio.userMaterialShareTop[0]).toEqual(expect.objectContaining({
      adminKey: "auth:7",
      bytes: 1_000,
      ratio: 1,
    }));
    expect(analytics.userMaterialRatio.userMaterialCountShareTop[0]).toEqual(expect.objectContaining({
      adminKey: "auth:7",
      count: 6,
      ratio: 1,
    }));
  });
});
