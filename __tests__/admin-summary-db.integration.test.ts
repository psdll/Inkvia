import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { measureAdminUserSummaryDiff, rebuildRecentDailyAnalytics } from "@/lib/admin-analytics-rollup";
import { processAdminEvents } from "@/lib/admin-operational";
import { listAdminUserSummaries } from "@/lib/admin-user-scope";
import { listAdminUserSummariesFromReadModel } from "@/lib/admin-user-summary-read-model";

const integrationIt = process.env.RUN_ADMIN_SUMMARY_DB_TEST === "1" ? it : it.skip;

describe("admin summary database integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  integrationIt("reconciles all daily buckets and matches the legacy user summary exactly", async () => {
    const source = await prisma.generation.findFirst({ orderBy: { id: "asc" }, select: { id: true, status: true } });
    if (source) {
      await prisma.adminWorkFeed.updateMany({
        where: { generationId: source.id },
        data: { status: "__stale_reconcile_test__" },
      });
    }
    const result = await rebuildRecentDailyAnalytics("all");
    expect(result.leaseAcquired).toBe(true);
    const diffSnapshot = await prisma.appSetting.findUnique({ where: { key: "admin_read_model_diff" } });
    expect(JSON.parse(diffSnapshot?.value || "{}").count).toBe(0);
    if (source) {
      const repaired = await prisma.adminWorkFeed.findUnique({
        where: { generationId: source.id },
        select: { status: true },
      });
      expect(repaired?.status).toBe(source.status);
    }

    const [legacy, summaries, dailyTotals, generationTotals] = await Promise.all([
      listAdminUserSummaries(),
      prisma.$queryRawUnsafe<Array<{
        adminKey: string;
        totalTaskCount: number;
        linkedUserIds: string[];
      }>>(`SELECT "adminKey", "totalTaskCount", "linkedUserIds" FROM "AdminUserSummary" WHERE "deletedAt" IS NULL ORDER BY "adminKey"`),
      prisma.$queryRawUnsafe<Array<{
        generationCount: bigint;
        successCount: bigint;
        failedCount: bigint;
        outputCount: bigint;
      }>>(`SELECT
        COALESCE(SUM("generationCount"), 0)::bigint AS "generationCount",
        COALESCE(SUM("successCount"), 0)::bigint AS "successCount",
        COALESCE(SUM("failedCount"), 0)::bigint AS "failedCount",
        COALESCE(SUM("imageCount" + "videoCount" + "faceCount" + "otherCount"), 0)::bigint AS "outputCount"
        FROM "AnalyticsDailyByUser"`),
      prisma.$queryRawUnsafe<Array<{
        generationCount: bigint;
        successCount: bigint;
        failedCount: bigint;
        outputCount: bigint;
      }>>(`SELECT
        COUNT(*)::bigint AS "generationCount",
        COUNT(*) FILTER (WHERE "type" <> 'import' AND "status" = 'success')::bigint AS "successCount",
        COUNT(*) FILTER (WHERE "type" <> 'import' AND "status" = 'failed')::bigint AS "failedCount",
        COUNT(*) FILTER (WHERE "type" <> 'import')::bigint AS "outputCount"
        FROM "Generation"`),
    ]);

    expect(summaries.map((row) => row.adminKey).sort()).toEqual(
      legacy.map((row) => row.adminKey).sort(),
    );
    for (const item of legacy) {
      const projected = summaries.find((row) => row.adminKey === item.adminKey);
      expect(projected?.totalTaskCount, item.adminKey).toBe(item.generationCount);
      expect([...(projected?.linkedUserIds || [])].sort(), item.adminKey).toEqual(
        [...item.linkedUserIds].sort(),
      );
    }
    expect(dailyTotals[0]).toEqual(generationTotals[0]);
  }, 60_000);

  integrationIt("rebuilds canonical display fields and tolerates invalid legacy metadata", async () => {
    const marker = `__admin_display_reconcile_${Date.now()}`;
    const generationIds: number[] = [];
    try {
      const [withMetadata, invalidMetadata] = await Promise.all([
        prisma.generation.create({
          data: {
            userId: marker,
            type: "image_edit",
            source: "tool",
            prompt: "display projection integration test",
            status: "failed",
            localPath: "uploads/original.png",
            errorMsg: "projection error",
            templateData: JSON.stringify({
              outputDisplayUrl: "uploads/display.webp",
              outputPreviewUrl: "uploads/preview.webp",
              outputPosterUrl: "uploads/poster.webp",
              outputThumbUrl: "uploads/thumb.webp",
              errorCode: "PROJECTION_TEST",
            }),
          },
        }),
        prisma.generation.create({
          data: {
            userId: marker,
            type: "video_gen",
            source: "tool",
            prompt: "invalid metadata projection integration test",
            status: "success",
            localPath: "uploads/fallback.mp4",
            templateData: "{invalid-json",
          },
        }),
      ]);
      generationIds.push(withMetadata.id, invalidMetadata.id);

      await rebuildRecentDailyAnalytics("all");
      const rows = await prisma.adminWorkFeed.findMany({
        where: { generationId: { in: generationIds } },
        orderBy: { generationId: "asc" },
      });
      const projected = rows.find((row) => row.generationId === withMetadata.id);
      const fallback = rows.find((row) => row.generationId === invalidMetadata.id);

      expect(projected).toEqual(expect.objectContaining({
        mediaKind: "image",
        displayUrl: "/uploads/display.webp",
        previewUrl: "/uploads/preview.webp",
        posterUrl: "/uploads/poster.webp",
        thumbUrl: "/uploads/thumb.webp",
        errorCode: "PROJECTION_TEST",
      }));
      expect(fallback).toEqual(expect.objectContaining({
        mediaKind: "video",
        displayUrl: "/uploads/fallback.mp4",
        previewUrl: "/uploads/fallback.mp4",
        posterUrl: null,
        thumbUrl: "/uploads/fallback.mp4",
        errorCode: null,
      }));
      const diffSnapshot = await prisma.appSetting.findUnique({ where: { key: "admin_read_model_diff" } });
      expect(JSON.parse(diffSnapshot?.value || "{}").count).toBe(0);
    } finally {
      if (generationIds.length) {
        await prisma.generation.deleteMany({ where: { id: { in: generationIds } } });
        await processAdminEvents(100, { workerId: "vitest-display-cleanup" });
      }
    }
  }, 60_000);

  integrationIt("makes a committed task visible through summaries in under three seconds", async () => {
    const user = await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
    expect(user).not.toBeNull();
    const before = await prisma.$queryRawUnsafe<Array<{ totalTaskCount: number }>>(
      `SELECT "totalTaskCount" FROM "AdminUserSummary" WHERE "adminKey" = $1`,
      `auth:${user!.id}`,
    );
    const marker = `__admin_summary_visibility_${Date.now()}`;
    let generationId = 0;
    const startedAt = Date.now();
    try {
      const generation = await prisma.generation.create({
        data: {
          userId: marker,
          authUserId: user!.id,
          type: "image_edit",
          source: "tool",
          prompt: "admin summary visibility integration test",
          status: "success",
        },
      });
      generationId = generation.id;
      const processed = await processAdminEvents(100, { workerId: "summary-visibility-integration" });
      const after = await prisma.$queryRawUnsafe<Array<{ totalTaskCount: number }>>(
        `SELECT "totalTaskCount" FROM "AdminUserSummary" WHERE "adminKey" = $1`,
        `auth:${user!.id}`,
      );
      const visibilityMs = Date.now() - startedAt;
      expect(processed.failed).toBe(0);
      expect(after[0]?.totalTaskCount).toBe((before[0]?.totalTaskCount || 0) + 1);
      expect(visibilityMs).toBeLessThan(3_000);
      console.info(`[admin-summary-gate] visibility_ms=${visibilityMs}`);

      await prisma.generation.delete({ where: { id: generationId } });
      await processAdminEvents(100, { workerId: "summary-visibility-integration" });
      const restored = await prisma.$queryRawUnsafe<Array<{ totalTaskCount: number }>>(
        `SELECT "totalTaskCount" FROM "AdminUserSummary" WHERE "adminKey" = $1`,
        `auth:${user!.id}`,
      );
      expect(restored[0]?.totalTaskCount).toBe(before[0]?.totalTaskCount || 0);
    } finally {
      if (generationId) {
        await prisma.generation.deleteMany({ where: { id: generationId } });
        await prisma.adminWorkFeed.deleteMany({ where: { generationId } });
        await prisma.adminEvent.deleteMany({ where: { entityType: "generation", entityId: String(generationId) } });
      }
    }
  }, 30_000);

  integrationIt("serves the user list below the 200ms p95 gate", async () => {
    const samples: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      const startedAt = performance.now();
      await listAdminUserSummariesFromReadModel({ limit: 500 });
      samples.push(performance.now() - startedAt);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    expect(p95).toBeLessThan(200);
    console.info(`[admin-summary-gate] users_p95_ms=${p95.toFixed(2)}`);
  }, 30_000);

  integrationIt("detects persisted storage aggregate drift", async () => {
    const summary = await prisma.adminUserSummary.findFirst({
      where: { deletedAt: null },
      orderBy: { adminKey: "asc" },
      select: { adminKey: true },
    });
    expect(summary).not.toBeNull();
    try {
      await prisma.adminUserSummary.update({
        where: { adminKey: summary!.adminKey },
        data: { storageBytes: { increment: BigInt(1) } },
      });
      const drift = await measureAdminUserSummaryDiff();
      expect(drift.count).toBeGreaterThan(0);
    } finally {
      await rebuildRecentDailyAnalytics("all");
    }
  }, 30_000);

  integrationIt("moves an existing guest device summary when that device becomes authenticated", async () => {
    const user = await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
    expect(user).not.toBeNull();
    const marker = `summary-link-${Date.now()}`;
    const before = await prisma.$queryRawUnsafe<Array<{ totalTaskCount: number }>>(
      `SELECT "totalTaskCount" FROM "AdminUserSummary" WHERE "adminKey" = $1`,
      `auth:${user!.id}`,
    );
    const generationIds: number[] = [];
    try {
      const guest = await prisma.generation.create({
        data: { userId: marker, type: "image_edit", source: "tool", prompt: "guest link test", status: "success" },
      });
      generationIds.push(guest.id);
      await processAdminEvents(100, { workerId: "summary-link-integration" });

      const authenticated = await prisma.generation.create({
        data: {
          userId: marker,
          authUserId: user!.id,
          type: "image_edit",
          source: "tool",
          prompt: "authenticated link test",
          status: "success",
        },
      });
      generationIds.push(authenticated.id);
      await processAdminEvents(100, { workerId: "summary-link-integration" });

      const [authSummary, guestSummary] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ totalTaskCount: number; linkedUserIds: string[] }>>(
          `SELECT "totalTaskCount", "linkedUserIds" FROM "AdminUserSummary" WHERE "adminKey" = $1`,
          `auth:${user!.id}`,
        ),
        prisma.$queryRawUnsafe<Array<{ totalTaskCount: number; deletedAt: Date | null }>>(
          `SELECT "totalTaskCount", "deletedAt" FROM "AdminUserSummary" WHERE "adminKey" = $1`,
          `guest:${marker}`,
        ),
      ]);
      expect(authSummary[0]?.totalTaskCount).toBe((before[0]?.totalTaskCount || 0) + 2);
      expect(authSummary[0]?.linkedUserIds).toContain(marker);
      expect(guestSummary[0]?.deletedAt).toBeInstanceOf(Date);
      expect(guestSummary[0]?.totalTaskCount).toBe(0);

      await prisma.generation.deleteMany({ where: { id: { in: generationIds } } });
      await processAdminEvents(100, { workerId: "summary-link-integration" });
      const revived = await prisma.generation.create({
        data: { userId: marker, type: "image_edit", source: "tool", prompt: "guest revival test", status: "success" },
      });
      generationIds.push(revived.id);
      await processAdminEvents(100, { workerId: "summary-link-integration" });
      const revivedSummary = await prisma.$queryRawUnsafe<Array<{ totalTaskCount: number; deletedAt: Date | null }>>(
        `SELECT "totalTaskCount", "deletedAt" FROM "AdminUserSummary" WHERE "adminKey" = $1`,
        `guest:${marker}`,
      );
      expect(revivedSummary[0]).toEqual(expect.objectContaining({ totalTaskCount: 1, deletedAt: null }));
    } finally {
      await prisma.generation.deleteMany({ where: { id: { in: generationIds } } });
      await processAdminEvents(100, { workerId: "summary-link-integration" });
      await prisma.adminWorkFeed.deleteMany({ where: { generationId: { in: generationIds } } });
      await prisma.adminEvent.deleteMany({ where: { entityType: "generation", entityId: { in: generationIds.map(String) } } });
      await rebuildRecentDailyAnalytics("all");
    }
  }, 30_000);

  integrationIt("reprojects guest history across unique-conflict-unique identity transitions", async () => {
    const marker = `summary-conflict-${Date.now()}`;
    const users = await Promise.all([
      prisma.user.create({ data: { username: `${marker}-a`, password: "integration-test" } }),
      prisma.user.create({ data: { username: `${marker}-b`, password: "integration-test" } }),
    ]);
    let generationIds: number[] = [];
    try {
      const guestGeneration = await prisma.generation.create({
        data: { userId: marker, type: "image_edit", source: "tool", prompt: "conflict guest", status: "success" },
      });
      generationIds.push(guestGeneration.id);
      await processAdminEvents(100, { workerId: "summary-conflict-integration" });

      const firstGeneration = await prisma.generation.create({
        data: { userId: marker, authUserId: users[0].id, type: "image_edit", source: "tool", prompt: "conflict a", status: "success" },
      });
      generationIds.push(firstGeneration.id);
      await processAdminEvents(100, { workerId: "summary-conflict-integration" });

      const uniqueFirst = await prisma.adminUserSummary.findUnique({ where: { adminKey: `auth:${users[0].id}` } });
      expect(uniqueFirst).toEqual(expect.objectContaining({ totalTaskCount: 2, authUserId: users[0].id }));

      const secondGeneration = await prisma.generation.create({
        data: { userId: marker, authUserId: users[1].id, type: "image_edit", source: "tool", prompt: "conflict b", status: "success" },
      });
      generationIds.push(secondGeneration.id);
      await processAdminEvents(100, { workerId: "summary-conflict-integration" });

      const [guest, first, second] = await Promise.all([
        prisma.adminUserSummary.findUnique({ where: { adminKey: `guest:${marker}` } }),
        prisma.adminUserSummary.findUnique({ where: { adminKey: `auth:${users[0].id}` } }),
        prisma.adminUserSummary.findUnique({ where: { adminKey: `auth:${users[1].id}` } }),
      ]);
      expect(guest).toEqual(expect.objectContaining({ totalTaskCount: 1, authUserId: null, deletedAt: null }));
      expect(first).toEqual(expect.objectContaining({ totalTaskCount: 1, authUserId: users[0].id }));
      expect(second).toEqual(expect.objectContaining({ totalTaskCount: 1, authUserId: users[1].id }));

      await prisma.generation.delete({ where: { id: secondGeneration.id } });
      await processAdminEvents(100, { workerId: "summary-conflict-integration" });
      const [mergedAgain, guestAfterResolution] = await Promise.all([
        prisma.adminUserSummary.findUnique({ where: { adminKey: `auth:${users[0].id}` } }),
        prisma.adminUserSummary.findUnique({ where: { adminKey: `guest:${marker}` } }),
      ]);
      expect(mergedAgain).toEqual(expect.objectContaining({ totalTaskCount: 2, authUserId: users[0].id }));
      expect(guestAfterResolution).toEqual(expect.objectContaining({ totalTaskCount: 0 }));
      expect(guestAfterResolution?.deletedAt).toBeInstanceOf(Date);
    } finally {
      await prisma.generation.deleteMany({ where: { id: { in: generationIds } } });
      await prisma.adminWorkFeed.deleteMany({ where: { generationId: { in: generationIds } } });
      await prisma.adminEvent.deleteMany({ where: { entityType: "generation", entityId: { in: generationIds.map(String) } } });
      await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
      await rebuildRecentDailyAnalytics("all");
    }
  }, 30_000);
});
