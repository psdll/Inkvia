import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { CanvasDocumentV2, CanvasEdge, CanvasNode } from "@/lib/canvas/document";
import { collectCanvasNodeMediaIds } from "@/lib/canvas/media-references";
import { canvasMetrics } from "@/lib/canvas/observability";
import { replayCanvasSnapshotHistory } from "@/lib/canvas/projection-rebuild";
import { buildCanvasSnapshot, decodeCanvasSnapshot, type EncodedCanvasSnapshot } from "@/lib/canvas/snapshot-codec";
import type { CanvasOperation } from "@/lib/canvas/operations";

type HistoryRow = {
  canvasRevision: bigint;
  snapshotId: bigint;
  revision: bigint;
  documentSchemaVersion: number;
  operationProtocolVersion: number;
  codec: string;
  compressedJson: Buffer;
  uncompressedBytes: number;
  checksumSha256: string;
  nodeCount: number;
  edgeCount: number;
  settings: CanvasDocumentV2["settings"];
  viewport: CanvasDocumentV2["viewport"] | null;
};

function viewport(value: CanvasDocumentV2["viewport"] | null): CanvasDocumentV2["viewport"] {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.zoom) && value.zoom > 0
    ? value
    : { x: 0, y: 0, zoom: 1 };
}

function nodeSearchText(node: CanvasNode) {
  return JSON.stringify(node.data).replace(/https?:\/\/\S+/g, " ").slice(0, 16_384);
}

function edgeBbox(edge: CanvasEdge, nodes: Map<string, CanvasNode>) {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  const sourceX = (source?.position.x ?? 0) + (source?.width ?? 0) / 2;
  const sourceY = (source?.position.y ?? 0) + (source?.height ?? 0) / 2;
  const targetX = (target?.position.x ?? 0) + (target?.width ?? 0) / 2;
  const targetY = (target?.position.y ?? 0) + (target?.height ?? 0) / 2;
  return { minX: Math.min(sourceX, targetX), minY: Math.min(sourceY, targetY), maxX: Math.max(sourceX, targetX), maxY: Math.max(sourceY, targetY) };
}

async function loadHistory(client: PrismaClient, canvasId: number) {
  const history = (await client.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT canvas."revision64" AS "canvasRevision", snapshot."id" AS "snapshotId", snapshot."revision",
      snapshot."documentSchemaVersion", snapshot."operationProtocolVersion", snapshot."codec",
      snapshot."compressedJson", snapshot."uncompressedBytes", snapshot."checksumSha256",
      snapshot."nodeCount", snapshot."edgeCount", canvas."settings", canvas."data"->'viewport' AS "viewport"
    FROM "Canvas" canvas
    JOIN "CanvasSnapshot" snapshot ON snapshot."id" = canvas."currentSnapshotId"
    WHERE canvas."id" = ${canvasId} AND canvas."deletedAt" IS NULL
    LIMIT 1
  `))[0];
  if (!history) throw new Error("CANVAS_REBUILD_SNAPSHOT_REQUIRED");
  if (history.codec !== "gzip") throw new Error("CANVAS_REBUILD_CODEC_UNSUPPORTED");
  const base = decodeCanvasSnapshot({
    revision: history.revision.toString(),
    documentSchemaVersion: history.documentSchemaVersion,
    operationProtocolVersion: history.operationProtocolVersion,
    codec: "gzip",
    compressedJson: history.compressedJson,
    uncompressedBytes: history.uncompressedBytes,
    checksumSha256: history.checksumSha256,
    nodeCount: history.nodeCount,
    edgeCount: history.edgeCount,
  } satisfies EncodedCanvasSnapshot);
  const mutations = await client.$queryRaw<Array<{ revision: bigint; protocolVersion: number; operations: CanvasOperation[] }>>(Prisma.sql`
    SELECT "revision", "protocolVersion", "operations" FROM "CanvasMutation"
    WHERE "canvasId" = ${canvasId} AND "revision" > ${history.revision} AND "revision" <= ${history.canvasRevision}
    ORDER BY "revision" ASC
  `);
  const document = replayCanvasSnapshotHistory(base, mutations.map((mutation) => ({
    revision: mutation.revision.toString(), protocolVersion: mutation.protocolVersion, operations: mutation.operations,
  })), history.revision.toString());
  const finalRevision = mutations.at(-1)?.revision ?? history.revision;
  if (finalRevision !== history.canvasRevision) throw new Error("CANVAS_HISTORY_REVISION_GAP");
  return { history, document: { ...document, settings: history.settings, viewport: viewport(history.viewport) } };
}

async function loadProjection(client: PrismaClient, canvasId: number, settings: CanvasDocumentV2["settings"], viewportValue: CanvasDocumentV2["viewport"]) {
  const [nodes, edges] = await Promise.all([
    client.$queryRaw<Array<{ data: CanvasNode }>>(Prisma.sql`SELECT "data" FROM "CanvasNodeState" WHERE "canvasId" = ${canvasId} ORDER BY "nodeId" ASC`),
    client.$queryRaw<Array<{ data: CanvasEdge }>>(Prisma.sql`SELECT "data" FROM "CanvasEdgeState" WHERE "canvasId" = ${canvasId} ORDER BY "edgeId" ASC`),
  ]);
  return { schemaVersion: 2, mode: "smart", nodes: nodes.map((row) => row.data), edges: edges.map((row) => row.data), settings, viewport: viewportValue } as CanvasDocumentV2;
}

export async function rebuildCanvasProjection(client: PrismaClient, input: { canvasId: number; repair?: boolean }) {
  const { history, document } = await loadHistory(client, input.canvasId);
  const projection = await loadProjection(client, input.canvasId, history.settings, viewport(history.viewport));
  const historyChecksum = buildCanvasSnapshot(document, history.canvasRevision.toString()).checksumSha256;
  const projectionChecksum = buildCanvasSnapshot(projection, history.canvasRevision.toString()).checksumSha256;
  const matches = historyChecksum === projectionChecksum;
  if (!input.repair || matches) {
    return { canvasId: input.canvasId, revision: history.canvasRevision.toString(), matches, repaired: false, historyChecksum, projectionChecksum };
  }

  await client.$transaction(async (tx) => {
    const locked = (await tx.$queryRaw<Array<{ revision64: bigint; currentSnapshotId: bigint | null }>>(Prisma.sql`
      SELECT "revision64", "currentSnapshotId" FROM "Canvas" WHERE "id" = ${input.canvasId} FOR UPDATE
    `))[0];
    if (!locked || locked.revision64 !== history.canvasRevision || locked.currentSnapshotId !== history.snapshotId) {
      throw new Error("CANVAS_REBUILD_SOURCE_CHANGED");
    }
    const previousRefs = await tx.$queryRaw<Array<{ mediaId: string }>>(Prisma.sql`
      SELECT "mediaId"::text AS "mediaId" FROM "MediaReference"
      WHERE "sourceType" = 'canvas_current' AND "sourceId" LIKE ${`canvas:${input.canvasId}:node:%`}
    `);
    const nextMediaIds = [...new Set(document.nodes.flatMap(collectCanvasNodeMediaIds))].sort();
    if (nextMediaIds.length) {
      const assets = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
        SELECT "id"::text AS "id", "status" FROM "MediaAsset"
        WHERE "id" IN (${Prisma.join(nextMediaIds.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})
        FOR UPDATE
      `);
      const available = new Set(assets.filter((asset) => asset.status !== "purging" && asset.status !== "purged").map((asset) => asset.id.toLowerCase()));
      const unavailable = nextMediaIds.filter((mediaId) => !available.has(mediaId));
      if (unavailable.length) throw new Error(`CANVAS_REBUILD_MEDIA_UNAVAILABLE: ${unavailable.join(", ")}`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset" SET "status" = 'ready', "retentionUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" IN (${Prisma.join(nextMediaIds.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})
          AND "status" = 'soft_deleted'
      `);
    }
    await tx.$executeRaw(Prisma.sql`DELETE FROM "MediaReference" WHERE "sourceType" = 'canvas_current' AND "sourceId" LIKE ${`canvas:${input.canvasId}:node:%`}`);
    await tx.$executeRaw(Prisma.sql`DELETE FROM "CanvasEdgeState" WHERE "canvasId" = ${input.canvasId}`);
    await tx.$executeRaw(Prisma.sql`DELETE FROM "CanvasNodeState" WHERE "canvasId" = ${input.canvasId}`);
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    for (const node of document.nodes) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CanvasNodeState" (
          "canvasId", "nodeId", "nodeVersion", "kind", "positionX", "positionY", "width", "height",
          "parentId", "zIndex", "data", "searchText", "updatedAt"
        ) VALUES (
          ${input.canvasId}, ${node.id}, ${history.canvasRevision}, ${node.type}, ${node.position.x}, ${node.position.y},
          ${node.width ?? null}, ${node.height ?? null}, ${node.parentId ?? null}, ${node.zIndex ?? 0},
          ${JSON.stringify(node)}::jsonb, ${nodeSearchText(node)}, CURRENT_TIMESTAMP
        )
      `);
      for (const mediaId of collectCanvasNodeMediaIds(node)) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "MediaReference" ("mediaId", "sourceType", "sourceId", "createdAt")
          SELECT ${mediaId}::uuid, 'canvas_current', ${`canvas:${input.canvasId}:node:${node.id}`}, CURRENT_TIMESTAMP
          FROM "MediaAsset" WHERE "id" = ${mediaId}::uuid AND "status" = 'ready'
          ON CONFLICT ("mediaId", "sourceType", "sourceId") DO NOTHING
        `);
      }
    }
    for (const edge of document.edges) {
      const bbox = edgeBbox(edge, nodes);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CanvasEdgeState" (
          "canvasId", "edgeId", "edgeVersion", "sourceId", "targetId", "bboxMinX", "bboxMinY", "bboxMaxX", "bboxMaxY", "data", "updatedAt"
        ) VALUES (
          ${input.canvasId}, ${edge.id}, ${history.canvasRevision}, ${edge.source}, ${edge.target},
          ${bbox.minX}, ${bbox.minY}, ${bbox.maxX}, ${bbox.maxY}, ${JSON.stringify(edge)}::jsonb, CURRENT_TIMESTAMP
        )
      `);
    }
    const affectedMedia = [...new Set([...previousRefs.map((item) => item.mediaId), ...nextMediaIds])];
    if (affectedMedia.length) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset" asset SET "referenceCount" = (
          SELECT COUNT(*)::integer FROM "MediaReference" reference WHERE reference."mediaId" = asset."id"
        ), "updatedAt" = CURRENT_TIMESTAMP
        WHERE asset."id" IN (${Prisma.join(affectedMedia.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset" SET "status" = 'soft_deleted',
          "retentionUntil" = CURRENT_TIMESTAMP + INTERVAL '30 days', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" IN (${Prisma.join(affectedMedia.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})
          AND "status" = 'ready' AND "referenceCount" = 0
      `);
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Canvas" SET "projectionRevision" = ${history.canvasRevision}, "nodeCount" = ${document.nodes.length},
        "edgeCount" = ${document.edges.length}, "settings" = ${JSON.stringify(document.settings)}::jsonb
      WHERE "id" = ${input.canvasId}
    `);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 120_000 });
  canvasMetrics.increment("canvas_projection_rebuild_total");
  return { canvasId: input.canvasId, revision: history.canvasRevision.toString(), matches: true, repaired: true, historyChecksum, projectionChecksum };
}
