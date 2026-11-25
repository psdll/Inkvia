import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { CANVAS_SCHEMA_VERSION, type CanvasDocumentV2, type CanvasEdge, type CanvasNode } from "@/lib/canvas/document";
import { CANVAS_OPERATION_PROTOCOL_VERSION } from "@/lib/canvas/operations";
import { CanvasProjectionStateError } from "@/lib/canvas/prisma-mutation-store";
import { buildCanvasSnapshot } from "@/lib/canvas/snapshot-codec";
import { collectCanvasNodeMediaIds } from "@/lib/canvas/media-references";

type CompactionRow = {
  revision64: bigint;
  projectionRevision: bigint;
  snapshotRevision: bigint;
  settings: unknown;
  viewport: unknown;
};

function viewport(value: unknown): CanvasDocumentV2["viewport"] {
  if (!value || typeof value !== "object") return { x: 0, y: 0, zoom: 1 };
  const item = value as Record<string, unknown>;
  return Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.zoom) && Number(item.zoom) > 0
    ? { x: Number(item.x), y: Number(item.y), zoom: Number(item.zoom) }
    : { x: 0, y: 0, zoom: 1 };
}

export async function compactCanvasSnapshot(
  client: PrismaClient,
  canvasId: number,
): Promise<{ kind: "created"; snapshotId: string; revision: string; bytes: number } | { kind: "current"; revision: string } | { kind: "not_found" }> {
  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<CompactionRow[]>(Prisma.sql`
      SELECT
        "revision64",
        "projectionRevision",
        "snapshotRevision",
        "settings",
        "data"->'viewport' AS "viewport"
      FROM "Canvas"
      WHERE "id" = ${canvasId} AND "deletedAt" IS NULL
      FOR SHARE
    `);
    const canvas = rows[0];
    if (!canvas) return { kind: "not_found" } as const;
    if (canvas.snapshotRevision >= canvas.revision64) {
      return { kind: "current", revision: canvas.revision64.toString() } as const;
    }
    if (canvas.projectionRevision !== canvas.revision64) {
      throw new CanvasProjectionStateError("cannot compact a projection that is behind the canvas revision");
    }
    const [nodeRows, edgeRows] = await Promise.all([
      tx.$queryRaw<Array<{ data: unknown }>>(Prisma.sql`
        SELECT "data" FROM "CanvasNodeState" WHERE "canvasId" = ${canvasId} ORDER BY "nodeId" ASC
      `),
      tx.$queryRaw<Array<{ data: unknown }>>(Prisma.sql`
        SELECT "data" FROM "CanvasEdgeState" WHERE "canvasId" = ${canvasId} ORDER BY "edgeId" ASC
      `),
    ]);
    const document: CanvasDocumentV2 = {
      schemaVersion: CANVAS_SCHEMA_VERSION,
      mode: "smart",
      nodes: nodeRows.map((row) => row.data as CanvasNode),
      edges: edgeRows.map((row) => row.data as CanvasEdge),
      viewport: viewport(canvas.viewport),
      settings: canvas.settings as CanvasDocumentV2["settings"],
    };
    const snapshot = buildCanvasSnapshot(document, canvas.revision64.toString());
    const inserted = await tx.$queryRaw<Array<{ id: bigint; checksumSha256: string }>>(Prisma.sql`
      INSERT INTO "CanvasSnapshot" (
        "canvasId", "revision", "documentSchemaVersion", "operationProtocolVersion", "codec",
        "compressedJson", "uncompressedBytes", "checksumSha256", "nodeCount", "edgeCount", "createdAt"
      ) VALUES (
        ${canvasId}, ${canvas.revision64}, ${CANVAS_SCHEMA_VERSION}, ${CANVAS_OPERATION_PROTOCOL_VERSION}, ${snapshot.codec},
        ${Buffer.from(snapshot.compressedJson)}, ${snapshot.uncompressedBytes}, ${snapshot.checksumSha256},
        ${snapshot.nodeCount}, ${snapshot.edgeCount}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("canvasId", "revision") DO NOTHING
      RETURNING "id", "checksumSha256"
    `);
    const existing = inserted[0] ?? (await tx.$queryRaw<Array<{ id: bigint; checksumSha256: string }>>(Prisma.sql`
      SELECT "id", "checksumSha256" FROM "CanvasSnapshot"
      WHERE "canvasId" = ${canvasId} AND "revision" = ${canvas.revision64}
      LIMIT 1
    `))[0];
    if (!existing || existing.checksumSha256 !== snapshot.checksumSha256) {
      throw new CanvasProjectionStateError("snapshot revision already exists with a different checksum");
    }
    const snapshotSourceId = `snapshot:${existing.id.toString()}`;
    const mediaIds = [...new Set(document.nodes.flatMap(collectCanvasNodeMediaIds))].sort();
    if (mediaIds.length) {
      const readyAssets = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"::text AS "id" FROM "MediaAsset"
        WHERE "status" = 'ready'
          AND "id" IN (${Prisma.join(mediaIds.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})
        FOR UPDATE
      `);
      const readyIds = new Set(readyAssets.map((asset) => asset.id.toLowerCase()));
      const invalidIds = mediaIds.filter((mediaId) => !readyIds.has(mediaId));
      if (invalidIds.length) {
        throw new CanvasProjectionStateError(`snapshot contains missing or unavailable media: ${invalidIds.join(", ")}`);
      }
      for (const mediaId of mediaIds) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "MediaReference" ("mediaId", "sourceType", "sourceId", "createdAt")
          VALUES (${mediaId}::uuid, 'canvas_snapshot', ${snapshotSourceId}, CURRENT_TIMESTAMP)
          ON CONFLICT ("mediaId", "sourceType", "sourceId") DO NOTHING
        `);
      }
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset" asset
        SET "referenceCount" = (
          SELECT COUNT(*)::integer FROM "MediaReference" reference WHERE reference."mediaId" = asset."id"
        ), "updatedAt" = CURRENT_TIMESTAMP
        WHERE asset."id" IN (${Prisma.join(mediaIds.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})
      `);
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Canvas"
      SET "currentSnapshotId" = ${existing.id}, "snapshotRevision" = ${canvas.revision64}
      WHERE "id" = ${canvasId} AND "revision64" = ${canvas.revision64}
    `);
    return {
      kind: "created",
      snapshotId: existing.id.toString(),
      revision: canvas.revision64.toString(),
      bytes: snapshot.compressedJson.byteLength,
    } as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 5000,
    timeout: 30000,
  });
}

export async function pruneCanvasSnapshots(
  client: PrismaClient,
  canvasId: number,
  keep = 3,
): Promise<{ deletedSnapshots: number; releasedMediaReferences: number }> {
  const keepCount = Math.max(1, Math.min(Math.floor(keep), 100));
  return client.$transaction(async (tx) => {
    const snapshots = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT snapshot."id"
      FROM "CanvasSnapshot" snapshot
      JOIN "Canvas" canvas ON canvas."id" = snapshot."canvasId"
      WHERE snapshot."canvasId" = ${canvasId}
        AND snapshot."id" IS DISTINCT FROM canvas."currentSnapshotId"
      ORDER BY snapshot."revision" DESC
      OFFSET ${keepCount - 1}
      FOR UPDATE OF snapshot
    `);
    if (!snapshots.length) return { deletedSnapshots: 0, releasedMediaReferences: 0 };
    const snapshotIds = snapshots.map((snapshot) => snapshot.id);
    const sourceIds = snapshotIds.map((id) => `snapshot:${id.toString()}`);
    const references = await tx.$queryRaw<Array<{ mediaId: string }>>(Prisma.sql`
      SELECT "mediaId"::text AS "mediaId" FROM "MediaReference"
      WHERE "sourceType" = 'canvas_snapshot' AND "sourceId" IN (${Prisma.join(sourceIds)})
    `);
    const releasedMediaIds = [...new Set(references.map((reference) => reference.mediaId.toLowerCase()))];
    const releasedMediaReferences = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "MediaReference"
      WHERE "sourceType" = 'canvas_snapshot' AND "sourceId" IN (${Prisma.join(sourceIds)})
    `);
    const deletedSnapshots = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "CanvasSnapshot" WHERE "id" IN (${Prisma.join(snapshotIds)})
    `);
    if (releasedMediaIds.length) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset" asset
        SET "referenceCount" = (
          SELECT COUNT(*)::integer FROM "MediaReference" reference WHERE reference."mediaId" = asset."id"
        ), "updatedAt" = CURRENT_TIMESTAMP
        WHERE asset."id" IN (${Prisma.join(releasedMediaIds.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset" SET "status" = 'soft_deleted',
          "retentionUntil" = CURRENT_TIMESTAMP + INTERVAL '30 days', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" IN (${Prisma.join(releasedMediaIds.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})
          AND "status" = 'ready' AND "referenceCount" = 0
      `);
    }
    return { deletedSnapshots, releasedMediaReferences };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5000,
    timeout: 30000,
  });
}
