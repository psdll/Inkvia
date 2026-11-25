import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CANVAS_TRASH_RETENTION_DAYS,
  canvasTrashRetentionCutoff,
} from "@/lib/canvas/trash-retention-config";
import { purgeExpiredCanvasTrashBatch } from "@/lib/canvas/trash-retention";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function sqlText(value: unknown) {
  const strings = (value as { strings?: readonly string[] })?.strings;
  return strings ? strings.join("?").replace(/\s+/g, " ").trim() : String(value);
}

describe("canvas trash retention", () => {
  it("expires a trashed canvas exactly 30 days after deletedAt", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");

    expect(CANVAS_TRASH_RETENTION_DAYS).toBe(30);
    expect(canvasTrashRetentionCutoff(now).toISOString()).toBe("2026-06-30T12:00:00.000Z");
  });

  it("locks and hard-deletes only expired trash while releasing media references", async () => {
    const mediaId = "d31782e3-d0fb-4aa1-9096-a7d16878cd55";
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ id: 11, authUserId: 7 }])
      .mockResolvedValueOnce([{ mediaId }]);
    const executeRaw = vi.fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    }));

    const result = await purgeExpiredCanvasTrashBatch(
      { $transaction: transaction } as never,
      { now: new Date("2026-07-30T12:00:00.000Z"), limit: 20 },
    );

    expect(result).toEqual({
      deletedCanvases: 1,
      releasedMediaReferences: 3,
      deletedUndoMediaHolds: 2,
      affectedMediaAssets: 1,
    });
    const claimSql = sqlText(queryRaw.mock.calls[0][0]);
    expect(claimSql).toContain('"deletedAt" <= ?');
    expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
    expect((queryRaw.mock.calls[0][0] as { values: unknown[] }).values).toContainEqual(
      new Date("2026-06-30T12:00:00.000Z"),
    );

    const mutationSql = executeRaw.mock.calls.map((call) => sqlText(call[0])).join("\n");
    expect(mutationSql).toContain('DELETE FROM "MediaReference"');
    expect(mutationSql).toContain('"sourceType" = \'canvas_current\'');
    expect(mutationSql).toContain('"sourceType" = \'canvas_snapshot\'');
    expect(mutationSql).toContain('DELETE FROM "CanvasUndoMediaHold"');
    expect(mutationSql).toContain('DELETE FROM "Canvas"');
    expect(mutationSql).toContain('"referenceCount" = (');
    expect(mutationSql).toContain('"retentionUntil" = CURRENT_TIMESTAMP');
    expect(mutationSql).toContain('FROM "GenerationInputMedia"');
    expect(mutationSql).toContain('FROM "ImageBatchMedia"');
  });

  it("does nothing when no canvas has reached the retention cutoff", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const executeRaw = vi.fn();
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    }));

    await expect(purgeExpiredCanvasTrashBatch(
      { $transaction: transaction } as never,
      { now: new Date("2026-07-30T12:00:00.000Z"), limit: 20 },
    )).resolves.toEqual({
      deletedCanvases: 0,
      releasedMediaReferences: 0,
      deletedUndoMediaHolds: 0,
      affectedMediaAssets: 0,
    });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("runs trash cleanup before media GC and exposes the 30-day policy in the UI", () => {
    const worker = read("scripts/canvas-worker.ts");
    const maintenance = read("app/api/internal/canvas-maintenance/route.ts");
    const page = read("app/canvas/page.tsx");
    const schema = read("prisma/schema.prisma");
    const migration = read(
      "prisma/migrations/20260730183000_canvas_trash_retention/migration.sql",
    );

    expect(worker).toContain("purgeExpiredCanvasTrashBatch");
    expect(worker.indexOf("purgeExpiredCanvasTrashBatch")).toBeLessThan(
      worker.indexOf("runCanvasMediaGcBatch", worker.indexOf("async function tick")),
    );
    expect(maintenance).toContain("purgeExpiredCanvasTrashBatch");
    expect(maintenance.indexOf("purgeExpiredCanvasTrashBatch")).toBeLessThan(
      maintenance.indexOf("runCanvasMediaGcBatch", maintenance.indexOf("export async function POST")),
    );
    expect(page).toContain("CANVAS_TRASH_RETENTION_DAYS");
    expect(page).toContain("回收站中的画布将在移入回收站");
    expect(page).toContain("天后自动删除，请及时恢复");
    expect(schema).toContain("@@index([deletedAt, id])");
    expect(migration).toContain(
      'CREATE INDEX "Canvas_deletedAt_id_idx" ON "Canvas"("deletedAt", "id")',
    );
  });
});
