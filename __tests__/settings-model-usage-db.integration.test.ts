import { afterAll, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async () => ({ id: 7 }) }));
vi.mock("@/lib/prisma", () => ({ default: { $queryRaw: (...args: any[]) => holder.db.$queryRaw(...args) } }));
import { GET } from "@/app/api/settings/model-usage/route";

let db: any;
afterAll(async () => { await db?.$disconnect(); });

const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;
integration("aggregates 10,000 rows in PostgreSQL while preserving ownership, legacy records and local-day boundaries", async () => {
  db = (await vi.importActual<typeof import("@/lib/prisma")>("@/lib/prisma")).default;
  await db.$transaction(async (tx: any) => {
    holder.db = tx;
    // Session-local temporary table: never insert benchmark records into user data.
    await tx.$executeRaw`CREATE TEMP TABLE "Generation" (
      "authUserId" integer, "userId" text, "model" text, "type" text, "status" text, "createdAt" timestamp
    ) ON COMMIT DROP`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start7 = new Date(today); start7.setDate(start7.getDate() - 6);
    const start30 = new Date(today); start30.setDate(start30.getDate() - 29);
    await tx.$executeRaw`INSERT INTO "Generation"
      SELECT 7, '7', 'x', 'image_gen', 'success', (${start30}::timestamptz AT TIME ZONE 'UTC') - interval '1 day'
      FROM generate_series(1, 10000)`;
    await tx.$executeRaw`INSERT INTO "Generation" VALUES
      (7, '7', ' x ', 'image_gen', 'success', ${today}),
      (NULL, '7', 'x', 'video_gen', 'FAILED', ${start7}),
      (8, '7', 'private', 'image_gen', 'success', ${today}),
      (7, '7', 'x', 'import', 'success', ${today}),
      (NULL, 'other', 'private', 'image_gen', 'success', ${today}),
      (7, '7', NULL, 'audio_gen', 'processing', ${today}),
      (7, '7', 'x', 'image_gen', 'failed', ${start7}),
      (7, '7', 'x', 'image_gen', 'success', (${start30}::timestamptz AT TIME ZONE 'UTC') - interval '1 millisecond'),
      (7, '7', 'z', 'image_gen', 'success', ${start30})`;
    const start = performance.now();
    const response = await GET(new Request("http://localhost/api/settings/model-usage") as any);
    const result = await response.json();
    const elapsedMs = Math.round(performance.now() - start);
    expect(response.status).toBe(200);
    expect(result.summary).toEqual({ total: 10006, last30: 5, last7: 4, activeModels30: 3, topModel30: "x" });
    expect(result.models.find((model: any) => model.model === "x")).toMatchObject({
      total: 10004, last30: 3, last7: 3, success: 10002, failed: 2, categories: { 图片: 10003, 视频: 1 },
    });
    expect(result.models.some((model: any) => model.model === "private")).toBe(false);
    expect(result.trend30.reduce((sum: number, day: any) => sum + day.total, 0)).toBe(5);
    expect(result.trend7.reduce((sum: number, day: any) => sum + day.total, 0)).toBe(4);
    console.info(JSON.stringify({ fixtureRows: 10009, matchedGenerations: result.summary.total, returnedModels: result.models.length, elapsedMs }));
  }, { timeout: 15000 });
}, 20000);
