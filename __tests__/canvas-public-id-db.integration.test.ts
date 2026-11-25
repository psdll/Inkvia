import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { createPrismaCanvasMutationStore, readCanvasBootstrapPage } from "@/lib/canvas/prisma-mutation-store";
import { submitCanvasMutation } from "@/lib/canvas/mutation-service";

const integrationIt = process.env.RUN_CANVAS_PUBLIC_ID_DB_TEST === "1" ? it : it.skip;
const prisma = new PrismaClient();

describe("canvas public identifiers in PostgreSQL", () => {
  afterAll(() => prisma.$disconnect());

  integrationIt("backfills existing canvases and enforces global uniqueness across owners", async () => {
    // This temporary table shadows Canvas only on this transaction's connection.
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "Canvas" ("id" INTEGER PRIMARY KEY, "authUserId" INTEGER NOT NULL, "data" JSONB NOT NULL) ON COMMIT DROP');
      await tx.$executeRawUnsafe(`INSERT INTO "Canvas" VALUES (1, 10, '{"nodes":["a"]}'), (2, 10, '{"nodes":["b"]}'), (3, 20, '{"nodes":["c"]}')`);
      const migration = readFileSync(resolve("prisma/migrations/20260903123000_canvas_public_id/migration.sql"), "utf8");
      for (const statement of migration.split(";").filter(value => value.trim())) await tx.$executeRawUnsafe(statement);
      const rows = await tx.$queryRawUnsafe<Array<{ id: number; authUserId: number; data: unknown; publicId: string }>>('SELECT * FROM "Canvas" ORDER BY "id"');
      expect(rows.map(({ id, authUserId, data }) => ({ id, authUserId, data }))).toEqual([
        { id: 1, authUserId: 10, data: { nodes: ["a"] } },
        { id: 2, authUserId: 10, data: { nodes: ["b"] } },
        { id: 3, authUserId: 20, data: { nodes: ["c"] } },
      ]);
      expect(rows.every(row => /^[0-9a-f]{32}$/.test(row.publicId))).toBe(true);
      expect(new Set(rows.map(row => row.publicId)).size).toBe(3);
      await tx.$executeRawUnsafe('INSERT INTO "Canvas" ("id", "authUserId", "data") SELECT 4, "authUserId", "data" FROM "Canvas" WHERE "id" = 1');
      const [copy] = await tx.$queryRawUnsafe<Array<{ publicId: string }>>('SELECT "publicId" FROM "Canvas" WHERE "id" = 4');
      expect(copy.publicId).toMatch(/^[0-9a-f]{32}$/);
      expect(rows.map(row => row.publicId)).not.toContain(copy.publicId);
      await tx.$executeRawUnsafe('SAVEPOINT duplicate_id');
      await expect(tx.$executeRawUnsafe('INSERT INTO "Canvas" ("id", "authUserId", "data", "publicId") SELECT 5, 30, "data", "publicId" FROM "Canvas" WHERE "id" = 1')).rejects.toMatchObject({ code: "P2010", meta: expect.objectContaining({ code: "23505" }) });
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_id');
    });
  });

  integrationIt("keeps two owners and multiple canvases isolated after public-ID resolution", async () => {
    const rollback = new Error("ROLLBACK_CANVAS_PUBLIC_ID_FIXTURES");
    await expect(prisma.$transaction(async tx => {
      const marker = randomUUID();
      const firstUser = await tx.user.create({ data: { username: `canvas-uuid-a-${marker}`, password: "test-only-unused" } });
      const secondUser = await tx.user.create({ data: { username: `canvas-uuid-b-${marker}`, password: "test-only-unused" } });
      const first = await tx.canvas.create({ data: { authUserId: firstUser.id, title: "first", data: createEmptyCanvasDocumentV2() } });
      const second = await tx.canvas.create({ data: { authUserId: firstUser.id, title: "second", data: createEmptyCanvasDocumentV2() } });
      const other = await tx.canvas.create({ data: { authUserId: secondUser.id, title: "other", data: createEmptyCanvasDocumentV2() } });
      expect(new Set([first.publicId, second.publicId, other.publicId]).size).toBe(3);
      const resolved = await tx.canvas.findUniqueOrThrow({ where: { publicId: second.publicId }, select: { id: true } });
      expect(resolved.id).toBe(second.id);
      const ownerRows = await tx.canvas.findMany({ where: { authUserId: firstUser.id }, select: { publicId: true } });
      expect(ownerRows.map(row => row.publicId).sort()).toEqual([first.publicId, second.publicId].sort());
      expect(await tx.canvas.findFirst({ where: { id: other.id, authUserId: firstUser.id } })).toBeNull();
      // Run the actual bootstrap access checks on the same rollback-only transaction.
      const client = { $transaction: (callback: (transaction: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient;
      expect(await readCanvasBootstrapPage(client, { canvasId: first.id, actorUserId: secondUser.id })).toEqual({ kind: "forbidden" });
      expect(await readCanvasBootstrapPage(client, { canvasId: other.id, actorUserId: firstUser.id })).toEqual({ kind: "forbidden" });
      await expect(submitCanvasMutation({ canvasId: first.id, actorUserId: secondUser.id, input: {
        protocolVersion: 1, clientMutationId: randomUUID(), clientSequence: 1, baseRevision: "1",
        operations: [{ opId: "move-1", kind: "node.move", nodeId: "node-a", position: { x: 10, y: 20 } }],
      } }, createPrismaCanvasMutationStore(client))).rejects.toMatchObject({ code: "CANVAS_FORBIDDEN", status: 403 });
      expect(await readCanvasBootstrapPage(client, { canvasId: resolved.id, actorUserId: firstUser.id })).toMatchObject({ kind: "ok", title: "second", nodes: [], edges: [] });
      await tx.canvas.update({ where: { id: first.id }, data: { title: "renamed", deletedAt: new Date() } });
      const restored = await tx.canvas.update({ where: { id: first.id }, data: { deletedAt: null } });
      expect(restored.publicId).toBe(first.publicId);
      expect((await tx.canvas.findUniqueOrThrow({ where: { id: second.id } })).title).toBe("second");
      throw rollback;
    }, { timeout: 15000 })).rejects.toBe(rollback);
  });
});
