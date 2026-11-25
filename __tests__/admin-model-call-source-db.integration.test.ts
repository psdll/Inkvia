import { afterAll, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { adminModelCallSource, loadAdminModelUsageRows, loadAdminUserModelCounts } from "@/lib/admin/model-call-source";
import { loadAdminAnalysisTrends } from "@/lib/admin/analysis-aggregates";
import { buildAdminModelReliability, type AdminModelReliabilitySourceRow } from "@/lib/admin-model-reliability";
import { buildAdminStorageAnalytics } from "@/lib/admin-storage-read-model";

let db: any;
afterAll(async () => { await db?.$disconnect(); });
const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;

integration("counts all API modalities once, preserves ownership, and excludes uploads and unfinished calls from rates", async () => {
  db = (await import("@/lib/prisma")).default;
  await db.$transaction(async (tx: any) => {
    await tx.$executeRaw`CREATE TEMP TABLE "Generation" (id int,"userId" text,"authUserId" int,"externalProvider" text,model text,type text,status text,"errorMsg" text,"createdAt" timestamp) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "UsageLedger" ("userId" text,"authUserId" int,"externalProvider" text,model text,module text,status text,"occurredAt" timestamp,"generationId" int,"unitType" text) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "Log" ("userId" text,category text,level text,"createdAt" timestamp) ON COMMIT DROP`;
    const now = new Date("2026-10-15T12:00:00+08:00");
    const since = new Date("2026-10-15T00:00:00+08:00");
    await tx.$executeRaw`INSERT INTO "Generation" VALUES
      (1,'7',7,'image-provider','image-model','image_edit','success',NULL,${now}),
      (2,'7',7,'volcengine-mediakit','erase-video-subtitle-pro-v5','video_gen','failed',NULL,${now}),
      (3,'7',7,NULL,'upload','import','success',NULL,${now})`;
    await tx.$executeRaw`INSERT INTO "UsageLedger" VALUES
      ('7',7,'image-provider','image-model','image','success',${now},1,'image'),
      ('7',7,'volcengine-mediakit','erase-video-subtitle-pro-v5','video','failed',${now},2,'minute'),
      ('7',7,'llm-provider','llm-model','agent','success',${now},NULL,'token'),
      ('7',7,'llm-provider','llm-model','agent','failed',${now},NULL,'token'),
      ('7',7,'llm-provider','llm-model','agent','running',${now},NULL,'token'),
      ('7',7,'llm-provider','llm-model','agent','cancelled',${now},NULL,'token'),
      ('old-device',NULL,'new-provider','future-api-model','new-module','success',${now},NULL,'request'),
      ('llm-only',9,'llm-provider','llm-only-model','agent','success',${now},NULL,'token'),
      ('7',8,'other','other-user-model','agent','success',${now},NULL,'token'),
      ('7',7,NULL,'deleted-upload','material','success',${now},NULL,'storage_item'),
      ('7',7,'old','outside-window','agent','success',${new Date("2026-09-01")},NULL,'token')`;
    const scope = { requestedUserId: "7", authUserId: 7, linkedUserIds: ["7", "old-device"], linkedGuestUserIds: ["old-device"], presetUserIds: ["7"], generationWhere: {}, logWhere: { userId: { in: ["old-device"] } } };
    const rows = await tx.$queryRaw(Prisma.sql`SELECT * FROM ${adminModelCallSource(scope)}`) as AdminModelReliabilitySourceRow[];
    const reliability = buildAdminModelReliability(rows, now).periods[0];
    expect(reliability).toMatchObject({ completedCount: 5, failedCount: 2, failureRate: 40 });
    expect(reliability.models.map(row => row.model).sort()).toEqual(["erase-video-subtitle-pro-v5", "future-api-model", "image-model", "llm-model"]);
    const trends = await loadAdminAnalysisTrends(scope, now, tx);
    expect(trends.modelFailurePeriods[0]).toMatchObject({ completedCount: 5, failedCount: 2, failureRate: 40 });
    expect(trends.modelFailurePeriods[0].models.find(row => row.model === "llm-model")).toMatchObject({ completedCount: 2, failedCount: 1 });
    const counts = await loadAdminUserModelCounts(scope, tx);
    expect(counts.find(row => row.model === "llm-model")?._count._all).toBe(4);
    expect(counts.some(row => row.model === "other-user-model")).toBe(false);
    const guestRows = await tx.$queryRaw(Prisma.sql`SELECT * FROM ${adminModelCallSource({ ...scope, authUserId: null, requestedUserId: "old-device" })}`);
    expect(guestRows.map((row: any) => row.model)).toEqual(["future-api-model"]);
    const modelUsageRows = await loadAdminModelUsageRows(since, now, tx);
    expect(modelUsageRows.reduce((sum, row) => sum + row.requestCount, 0)).toBe(9);
    expect(modelUsageRows.find(row => row.model === "image-model")?.requestCount).toBe(1);
    const zero = { generationCount: 0, successCount: 0, failedCount: 0, storageBytes: 0, imageCount: 0, videoCount: 0, faceCount: 0, otherCount: 0 };
    const analytics = buildAdminStorageAnalytics({ days: 30, totalBytes: 0, summaries: [], modelUsageRows, rollup: { daily: [], perUser: [], totals: zero } });
    expect(analytics.modelUsage.modelOutcomeTop.find(row => row.model === "llm-model")).toMatchObject({ totalCalls: 4, successRate: 0.5, failedRate: 0.5 });
    expect(analytics.modelUsage.userModelMix.find(row => row.adminKey === "auth:9")).toMatchObject({ totalCalls: 1, cells: { "llm-only-model": 1 } });
    expect(analytics.totals.totalGenerations).toBe(0);
  });
});
