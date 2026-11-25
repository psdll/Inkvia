import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import { PrismaClient } from "@prisma/client";
import { performance } from "node:perf_hooks";

const databaseUrl = String(process.env.DATABASE_URL || "");
const databaseName = (() => {
  try { return new URL(databaseUrl).pathname.replace(/^\//, ""); } catch { return ""; }
})();
if (!databaseName.endsWith("_load_gate") || process.env.ADMIN_LOAD_GATE_CONFIRM !== databaseName) {
  throw new Error("refusing load gate: use an isolated *_load_gate database and set ADMIN_LOAD_GATE_CONFIRM to its name");
}

const prisma = createGuardedPrismaClient();
const seed = process.argv.includes("--seed");
const sampleCount = 30;

function scanRows(plan) {
  const own = /Scan$/.test(String(plan["Node Type"] || ""))
    ? (Number(plan["Actual Rows"] || 0) + Number(plan["Rows Removed by Filter"] || 0))
      * Math.max(1, Number(plan["Actual Loops"] || 1))
    : 0;
  return Math.max(own, ...(plan.Plans || []).map(scanRows), 0);
}

function hasNodeType(plan, nodeType) {
  return String(plan["Node Type"] || "") === nodeType
    || (plan.Plans || []).some((child) => hasNodeType(child, nodeType));
}

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function timed(query) {
  const startedAt = performance.now();
  const rows = await prisma.$queryRawUnsafe(query);
  return { rows, ms: performance.now() - startedAt };
}

async function explainPlan(query) {
  const rows = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
  return rows[0]["QUERY PLAN"][0].Plan;
}

try {
  if (seed) {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AdminUserSummary", "AdminWorkFeed", "Generation", "AdminEvent" RESTART IDENTITY CASCADE');
    await prisma.$executeRawUnsafe(`INSERT INTO "User" ("id", "username", "password", "createdAt", "updatedAt")
      VALUES (7, 'load-gate-auth', 'load-gate-only', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING`);
    await prisma.$executeRawUnsafe('ALTER TABLE "Generation" DISABLE TRIGGER USER');
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO "Generation" (
        "userId", "authUserId", "type", "source", "prompt", "status", "sizeBytes", "createdAt", "updatedAt"
      ) SELECT
        CASE
          WHEN value <= 100000 THEN 'load-gate-user'
          WHEN value <= 200000 THEN 'load-auth-device-' || (value % 2)::text
          ELSE 'load-user-' || (value % 100000)::text
        END,
        CASE WHEN value BETWEEN 100001 AND 199000 THEN 7 ELSE NULL END,
        'image_edit', 'tool', 'load gate', 'success', 1024,
        CURRENT_TIMESTAMP - value * INTERVAL '1 millisecond',
        CURRENT_TIMESTAMP - value * INTERVAL '1 millisecond'
      FROM generate_series(1, 1000000) AS value`);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Generation" ENABLE TRIGGER USER');
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "AdminWorkFeed" (
      "generationId", "sourceEventId", "userId", "authUserId", "type", "status", "source", "mediaKind",
      "sizeBytes", "sizeBytes64", "createdAt", "updatedAt"
    ) SELECT "id", "id", "userId",
        CASE WHEN "id" BETWEEN 100001 AND 199000 THEN 7 ELSE NULL END,
        "type", "status", "source", 'image', "sizeBytes", "sizeBytes", "createdAt", "updatedAt"
      FROM "Generation"`);
    await prisma.$executeRawUnsafe(`INSERT INTO "AdminEvent" (
      "eventType", "entityType", "entityId", "status", "processedAt"
    ) SELECT 'load.done', 'generation', value::text, 'done', CURRENT_TIMESTAMP
      FROM generate_series(1, 1000000) AS value`);
    await prisma.$executeRawUnsafe(`INSERT INTO "AdminEvent" (
      "eventType", "entityType", "entityId", "status"
    ) VALUES ('load.pending', 'generation', '1000001', 'pending')`);
    await prisma.$executeRawUnsafe(`INSERT INTO "AdminUserSummary" (
      "adminKey", "userId", "lastActiveAt", "totalTaskCount", "linkedUserIds", "updatedAt"
      ) SELECT
      'guest:load-user-' || value::text,
      'load-user-' || value::text,
      CURRENT_TIMESTAMP - value * INTERVAL '1 millisecond',
      10,
      jsonb_build_array('load-user-' || value::text),
      CURRENT_TIMESTAMP - value * INTERVAL '1 millisecond'
    FROM generate_series(1, 100000) AS value`);
    await prisma.$executeRawUnsafe('ANALYZE "Generation"');
    await prisma.$executeRawUnsafe('ANALYZE "AdminWorkFeed"');
    await prisma.$executeRawUnsafe('ANALYZE "AdminUserSummary"');
    await prisma.$executeRawUnsafe('ANALYZE "AdminEvent"');
  }

  const counts = await prisma.$queryRawUnsafe(`SELECT
    (SELECT COUNT(*)::int FROM "Generation") AS generations,
    (SELECT COUNT(*)::int FROM "Generation" WHERE "userId" = 'load-gate-user') AS user_works,
    (SELECT COUNT(*)::int FROM "AdminWorkFeed"
      WHERE ("authUserId" = 7 OR ("authUserId" IS NULL AND "userId" IN ('load-auth-device-0', 'load-auth-device-1')))) AS registered_works,
    (SELECT COUNT(*)::int FROM "AdminUserSummary" WHERE "deletedAt" IS NULL) AS summaries,
    (SELECT COUNT(*)::int FROM "AdminEvent") AS events,
    (SELECT COUNT(*)::int FROM "AdminEvent" WHERE "status" <> 'done') AS unfinished_events`);
  if (
    Number(counts[0]?.generations) !== 1_000_000
    || Number(counts[0]?.user_works) !== 100_000
    || Number(counts[0]?.registered_works) !== 100_000
    || Number(counts[0]?.summaries) !== 100_000
    || Number(counts[0]?.events) !== 1_000_001
    || Number(counts[0]?.unfinished_events) !== 1
  ) {
    throw new Error(`load fixture mismatch: ${JSON.stringify(counts[0])}`);
  }
  const sourceWaterQuery = `SELECT COALESCE(
      (SELECT "id" - 1 FROM "AdminEvent" WHERE "status" <> 'done' ORDER BY "id" ASC LIMIT 1),
      (SELECT "id" FROM "AdminEvent" ORDER BY "id" DESC LIMIT 1),
      0
    )::int AS "sourceEventId"`;
  const countQuery = `SELECT COUNT(*)::int AS "total" FROM "AdminWorkFeed"
    WHERE "userId" = 'load-gate-user' AND "deletedAt" IS NULL AND "type" <> 'import'`;
  const pageQuery = `SELECT "generationId" FROM "AdminWorkFeed"
    WHERE "userId" = 'load-gate-user' AND "deletedAt" IS NULL AND "type" <> 'import'
    ORDER BY "createdAt" DESC, "generationId" DESC LIMIT 41`;
  const registeredAuthPageQuery = `SELECT "generationId" FROM "AdminWorkFeed"
    WHERE "authUserId" = 7 AND "deletedAt" IS NULL AND "type" <> 'import'
    ORDER BY "createdAt" DESC, "generationId" DESC LIMIT 41`;
  const registeredGuestPageQuery0 = `SELECT "generationId" FROM "AdminWorkFeed"
    WHERE "authUserId" IS NULL AND "userId" = 'load-auth-device-0'
      AND "deletedAt" IS NULL AND "type" <> 'import'
    ORDER BY "createdAt" DESC, "generationId" DESC LIMIT 41`;
  const registeredGuestPageQuery1 = `SELECT "generationId" FROM "AdminWorkFeed"
    WHERE "authUserId" IS NULL AND "userId" = 'load-auth-device-1'
      AND "deletedAt" IS NULL AND "type" <> 'import'
    ORDER BY "createdAt" DESC, "generationId" DESC LIMIT 41`;
  const changesQuery = `SELECT "generationId", "sourceEventId" FROM "AdminWorkFeed"
    WHERE "authUserId" IS NULL AND "userId" = 'load-gate-user'
      AND "deletedAt" IS NULL AND "type" <> 'import'
      AND "sourceEventId" > 99900 AND "sourceEventId" <= 1000000
    ORDER BY "sourceEventId" ASC, "generationId" ASC LIMIT 101`;
  const summaryHighWaterQuery = `SELECT "updatedAt", "adminKey" FROM "AdminUserSummary"
    ORDER BY "updatedAt" DESC, "adminKey" DESC LIMIT 1`;
  const summaryQuery = `SELECT "adminKey", "userId", "lastActiveAt", "totalTaskCount", "updatedAt"
    FROM "AdminUserSummary" WHERE "deletedAt" IS NULL
    ORDER BY "lastActiveAt" DESC NULLS LAST, "adminKey" ASC LIMIT 501`;
  const summaryCursorTime = `(SELECT "lastActiveAt" FROM "AdminUserSummary" WHERE "adminKey" = 'guest:load-user-50000')`;
  const summaryDeepSameTimeQuery = `SELECT "adminKey", "lastActiveAt" FROM "AdminUserSummary"
    WHERE "deletedAt" IS NULL AND "lastActiveAt" = ${summaryCursorTime}
      AND "adminKey" > 'guest:load-user-50000'
    ORDER BY "lastActiveAt" DESC NULLS LAST, "adminKey" ASC LIMIT 501`;
  const summaryDeepOlderQuery = `SELECT "adminKey", "lastActiveAt" FROM "AdminUserSummary"
    WHERE "deletedAt" IS NULL AND "lastActiveAt" < ${summaryCursorTime}
    ORDER BY "lastActiveAt" DESC NULLS LAST, "adminKey" ASC LIMIT 501`;
  const summaryDeepNullQuery = `SELECT "adminKey", "lastActiveAt" FROM "AdminUserSummary"
    WHERE "deletedAt" IS NULL AND "lastActiveAt" IS NULL
    ORDER BY "lastActiveAt" DESC NULLS LAST, "adminKey" ASC LIMIT 501`;
  const summaryChangeCursorTime = `(SELECT "updatedAt" FROM "AdminUserSummary" WHERE "adminKey" = 'guest:load-user-50000')`;
  const summaryChangesSameTimeQuery = `SELECT "adminKey", "updatedAt" FROM "AdminUserSummary"
    WHERE "updatedAt" = ${summaryChangeCursorTime} AND "adminKey" > 'guest:load-user-50000'
    ORDER BY "updatedAt" ASC, "adminKey" ASC LIMIT 101`;
  const summaryChangesLaterQuery = `SELECT "adminKey", "updatedAt" FROM "AdminUserSummary"
    WHERE "updatedAt" > ${summaryChangeCursorTime}
    ORDER BY "updatedAt" ASC, "adminKey" ASC LIMIT 101`;
  const [
    sourcePlan,
    countPlan,
    pagePlan,
    registeredAuthPagePlan,
    registeredGuestPagePlan0,
    registeredGuestPagePlan1,
    changesPlan,
    summaryPlan,
    summaryDeepSameTimePlan,
    summaryDeepOlderPlan,
    summaryDeepNullPlan,
    summaryChangesSameTimePlan,
    summaryChangesLaterPlan,
  ] = await Promise.all([
    explainPlan(sourceWaterQuery),
    explainPlan(countQuery),
    explainPlan(pageQuery),
    explainPlan(registeredAuthPageQuery),
    explainPlan(registeredGuestPageQuery0),
    explainPlan(registeredGuestPageQuery1),
    explainPlan(changesQuery),
    explainPlan(summaryQuery),
    explainPlan(summaryDeepSameTimeQuery),
    explainPlan(summaryDeepOlderQuery),
    explainPlan(summaryDeepNullQuery),
    explainPlan(summaryChangesSameTimeQuery),
    explainPlan(summaryChangesLaterQuery),
  ]);
  const sourceWaterScannedRows = scanRows(sourcePlan);
  const pageScannedRows = scanRows(pagePlan);
  const summaryScannedRows = scanRows(summaryPlan);
  const registeredPageScannedRows = scanRows(registeredAuthPagePlan)
    + scanRows(registeredGuestPagePlan0)
    + scanRows(registeredGuestPagePlan1);
  const changesScannedRows = scanRows(changesPlan);
  const summaryDeepScannedRows = scanRows(summaryDeepSameTimePlan) + scanRows(summaryDeepOlderPlan) + scanRows(summaryDeepNullPlan);
  const summaryChangesScannedRows = scanRows(summaryChangesSameTimePlan) + scanRows(summaryChangesLaterPlan);
  const countUsesSeqScan = hasNodeType(countPlan, "Seq Scan");
  await prisma.$queryRawUnsafe(sourceWaterQuery);
  await Promise.all([prisma.$queryRawUnsafe(countQuery), prisma.$queryRawUnsafe(pageQuery)]);
  await Promise.all([
    prisma.$queryRawUnsafe(summaryHighWaterQuery),
    prisma.$queryRawUnsafe(summaryQuery),
    prisma.$queryRawUnsafe(summaryDeepSameTimeQuery),
    prisma.$queryRawUnsafe(summaryDeepOlderQuery),
    prisma.$queryRawUnsafe(summaryDeepNullQuery),
    prisma.$queryRawUnsafe(summaryChangesSameTimeQuery),
    prisma.$queryRawUnsafe(summaryChangesLaterQuery),
    prisma.$queryRawUnsafe(changesQuery),
  ]);

  const worksSamples = [];
  const sourceWaterSamples = [];
  const countSamples = [];
  const pageSamples = [];
  const usersSamples = [];
  const registeredWorksSamples = [];
  const changesSamples = [];
  const summaryHighWaterSamples = [];
  const summaryChangesSamples = [];
  const summaryDeepSamples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const sourceWater = await timed(sourceWaterQuery);
    const page = await timed(pageQuery);
    worksSamples.push(Math.max(sourceWater.ms, page.ms));
    const count = await timed(countQuery);
    sourceWaterSamples.push(sourceWater.ms);
    countSamples.push(count.ms);
    pageSamples.push(page.ms);
    const registeredStartedAt = performance.now();
    await Promise.all([
      timed(sourceWaterQuery),
      timed(registeredAuthPageQuery),
      timed(registeredGuestPageQuery0),
      timed(registeredGuestPageQuery1),
    ]);
    registeredWorksSamples.push(performance.now() - registeredStartedAt);
    changesSamples.push((await timed(changesQuery)).ms);
    const usersStartedAt = performance.now();
    const [highWater] = await Promise.all([timed(summaryHighWaterQuery), timed(summaryQuery)]);
    summaryHighWaterSamples.push(highWater.ms);
    usersSamples.push(performance.now() - usersStartedAt);
    const summaryDeepStartedAt = performance.now();
    await Promise.all([
      timed(summaryDeepSameTimeQuery),
      timed(summaryDeepOlderQuery),
      timed(summaryDeepNullQuery),
    ]);
    summaryDeepSamples.push(performance.now() - summaryDeepStartedAt);
    const summaryChangesStartedAt = performance.now();
    await Promise.all([timed(summaryChangesSameTimeQuery), timed(summaryChangesLaterQuery)]);
    summaryChangesSamples.push(performance.now() - summaryChangesStartedAt);
  }
  const round = (value) => Math.round(value * 100) / 100;
  const worksP95Ms = p95(worksSamples);
  const usersP95Ms = p95(usersSamples);
  const sourceWaterP95Ms = p95(sourceWaterSamples);
  const registeredWorksP95Ms = p95(registeredWorksSamples);
  const changesP95Ms = p95(changesSamples);
  const summaryHighWaterP95Ms = p95(summaryHighWaterSamples);
  const summaryChangesP95Ms = p95(summaryChangesSamples);
  const result = {
    ...counts[0],
    sourceWaterScannedRows,
    pageScannedRows,
    summaryScannedRows,
    registeredPageScannedRows,
    changesScannedRows,
    summaryDeepScannedRows,
    summaryChangesScannedRows,
    countUsesSeqScan,
    worksP95Ms: round(worksP95Ms),
    sourceWaterP95Ms: round(sourceWaterP95Ms),
    countP95Ms: round(p95(countSamples)),
    pageP95Ms: round(p95(pageSamples)),
    usersP95Ms: round(usersP95Ms),
    registeredWorksP95Ms: round(registeredWorksP95Ms),
    changesP95Ms: round(changesP95Ms),
    summaryHighWaterP95Ms: round(summaryHighWaterP95Ms),
    summaryChangesP95Ms: round(summaryChangesP95Ms),
    summaryDeepP95Ms: round(p95(summaryDeepSamples)),
    samples: sampleCount,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    sourceWaterScannedRows > 80
    || pageScannedRows > 80
    || registeredPageScannedRows > 150
    || changesScannedRows > 200
    || summaryScannedRows > 1_000
    || summaryDeepScannedRows > 2_000
    || summaryChangesScannedRows > 200
    || sourceWaterP95Ms >= 50
    || worksP95Ms >= 300
    || registeredWorksP95Ms >= 300
    || changesP95Ms >= 300
    || usersP95Ms >= 200
    || summaryHighWaterP95Ms >= 50
    || summaryChangesP95Ms >= 200
    || p95(summaryDeepSamples) >= 200
  ) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
