import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { parseCanvasDocumentV2, type CanvasEdge, type CanvasNode, type CanvasSettings } from "@/lib/canvas/document";
import { CANVAS_MAX_EDGES, CANVAS_MAX_NODES, CanvasLimitError } from "@/lib/canvas/limits";
import type {
  CanvasMutationCommitInput,
  CanvasMutationCommitOutcome,
  CanvasMutationStore,
  StoredCanvasMutation,
} from "@/lib/canvas/mutation-service";
import {
  applyCanvasProjectionOperations,
  collectCanvasProjectionRequirements,
} from "@/lib/canvas/projection";
import { collectCanvasCurrentMediaReferenceChanges } from "@/lib/canvas/media-references";

type TransactionClient = Prisma.TransactionClient;

type CanvasAccessRow = {
  id: number;
  revision64: bigint;
  projectionRevision: bigint;
  nodeCount: number;
  edgeCount: number;
  settings: unknown;
  canEdit: boolean;
};

type StoredMutationRow = {
  revision: bigint;
  protocolVersion: number;
  operations: unknown;
  touchedPaths: unknown;
};

type ProjectionNodeRow = { data: unknown };
type ProjectionEdgeRow = { data: unknown };

export class CanvasProjectionStateError extends Error {
  readonly code = "CANVAS_PROJECTION_OUT_OF_SYNC";
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "CanvasProjectionStateError";
  }
}

export class CanvasMediaReferenceError extends Error {
  constructor(
    message: string,
    readonly code = "CANVAS_MEDIA_REFERENCE_INVALID",
    readonly status = 409,
  ) {
    super(message);
    this.name = "CanvasMediaReferenceError";
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asStoredMutations(rows: StoredMutationRow[]): StoredCanvasMutation[] {
  return rows.map((row) => ({
    revision: row.revision,
    protocolVersion: row.protocolVersion,
    operations: row.operations as StoredCanvasMutation["operations"],
    touchedPaths: asStringArray(row.touchedPaths),
  }));
}

function parseSettings(value: unknown): CanvasSettings | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return typeof item.snapToGrid === "boolean" && Number.isInteger(item.gridSize) && Number(item.gridSize) > 0
    ? { snapToGrid: item.snapToGrid, gridSize: Number(item.gridSize) }
    : null;
}

function nodeSearchText(node: CanvasNode): string {
  const data = node.data as unknown as Record<string, unknown>;
  return [data.title, data.name, data.prompt, data.text]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .slice(0, 8192);
}

function edgeBbox(edge: CanvasEdge, nodes: readonly CanvasNode[]) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return { minX: null, minY: null, maxX: null, maxY: null };
  const sourceX = source.position.x + (source.width ?? 0) / 2;
  const sourceY = source.position.y + (source.height ?? 0) / 2;
  const targetX = target.position.x + (target.width ?? 0) / 2;
  const targetY = target.position.y + (target.height ?? 0) / 2;
  return {
    minX: Math.min(sourceX, targetX),
    minY: Math.min(sourceY, targetY),
    maxX: Math.max(sourceX, targetX),
    maxY: Math.max(sourceY, targetY),
  };
}

async function findAccess(tx: TransactionClient, canvasId: number, actorUserId: number): Promise<CanvasAccessRow | null> {
  const rows = await tx.$queryRaw<CanvasAccessRow[]>(Prisma.sql`
    SELECT
      c."id",
      c."revision64",
      c."projectionRevision",
      c."nodeCount",
      c."edgeCount",
      c."settings",
      (
        c."authUserId" = ${actorUserId}
        OR EXISTS (
          SELECT 1 FROM "CanvasMember" member
          WHERE member."canvasId" = c."id"
            AND member."userId" = ${actorUserId}
            AND member."role" IN ('OWNER', 'EDITOR')
        )
      ) AS "canEdit"
    FROM "Canvas" c
    WHERE c."id" = ${canvasId} AND c."deletedAt" IS NULL
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function findDuplicate(
  tx: TransactionClient,
  canvasId: number,
  clientMutationId: string,
): Promise<{ revision: bigint; payloadHash: string } | null> {
  const rows = await tx.$queryRaw<Array<{ revision: bigint; payloadHash: string }>>(Prisma.sql`
    SELECT "revision", "payloadHash"
    FROM "CanvasMutation"
    WHERE "canvasId" = ${canvasId} AND "clientMutationId" = ${clientMutationId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function conflictOutcome(
  tx: TransactionClient,
  canvasId: number,
  baseRevision: bigint,
  currentRevision: bigint,
): Promise<CanvasMutationCommitOutcome> {
  const rows = await tx.$queryRaw<StoredMutationRow[]>(Prisma.sql`
    SELECT "revision", "protocolVersion", "operations", "touchedPaths"
    FROM "CanvasMutation"
    WHERE "canvasId" = ${canvasId} AND "revision" > ${baseRevision}
    ORDER BY "revision" ASC
    LIMIT 101
  `);
  return {
    kind: "conflict",
    currentRevision,
    hasMore: rows.length > 100,
    missingMutations: asStoredMutations(rows.slice(0, 100)),
  };
}

async function initializeProjection(
  tx: TransactionClient,
  canvasId: number,
  revision: bigint,
): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[]; settings: CanvasSettings }> {
  const rows = await tx.$queryRaw<Array<{ data: unknown }>>(Prisma.sql`
    SELECT "data" FROM "Canvas" WHERE "id" = ${canvasId} LIMIT 1
  `);
  const document = parseCanvasDocumentV2(rows[0]?.data);
  const nodesJson = JSON.stringify(document.nodes);
  const edgesJson = JSON.stringify(document.edges);

  if (document.nodes.length) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CanvasNodeState" (
        "canvasId", "nodeId", "nodeVersion", "kind", "positionX", "positionY",
        "width", "height", "parentId", "zIndex", "data", "searchText", "updatedAt"
      )
      SELECT
        ${canvasId},
        node->>'id',
        ${revision},
        node->>'type',
        (node->'position'->>'x')::double precision,
        (node->'position'->>'y')::double precision,
        NULLIF(node->>'width', '')::double precision,
        NULLIF(node->>'height', '')::double precision,
        node->>'parentId',
        COALESCE((node->>'zIndex')::integer, 0),
        node,
        LEFT(CONCAT_WS(' ', node->'data'->>'title', node->'data'->>'name', node->'data'->>'prompt', node->'data'->>'text'), 8192),
        CURRENT_TIMESTAMP
      FROM jsonb_array_elements(${nodesJson}::jsonb) AS node
      ON CONFLICT ("canvasId", "nodeId") DO NOTHING
    `);
  }
  if (document.edges.length) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CanvasEdgeState" (
        "canvasId", "edgeId", "edgeVersion", "sourceId", "targetId",
        "bboxMinX", "bboxMinY", "bboxMaxX", "bboxMaxY", "data", "updatedAt"
      )
      SELECT
        ${canvasId}, edge->>'id', ${revision}, edge->>'source', edge->>'target',
        NULL, NULL, NULL, NULL, edge, CURRENT_TIMESTAMP
      FROM jsonb_array_elements(${edgesJson}::jsonb) AS edge
      ON CONFLICT ("canvasId", "edgeId") DO NOTHING
    `);
  }
  await syncCanvasCurrentMediaReferences(tx, canvasId, document.nodes, []);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Canvas"
    SET
      "projectionRevision" = ${revision},
      "nodeCount" = ${document.nodes.length},
      "edgeCount" = ${document.edges.length},
      "settings" = ${JSON.stringify(document.settings)}::jsonb
    WHERE "id" = ${canvasId}
  `);
  return { nodes: document.nodes, edges: document.edges, settings: document.settings };
}

export async function syncCanvasCurrentMediaReferences(
  tx: TransactionClient,
  canvasId: number,
  nodeUpserts: readonly CanvasNode[],
  nodeDeletes: readonly string[],
  actorUserId?: number,
) {
  const changes = collectCanvasCurrentMediaReferenceChanges(canvasId, nodeUpserts, nodeDeletes);
  if (!changes.length) return;
  const sourceIds = changes.map((change) => change.sourceId);
  const requestedMediaIds = [...new Set(changes.flatMap((change) => change.mediaIds))].sort();
  const existing = await tx.$queryRaw<Array<{ mediaId: string }>>(Prisma.sql`
    SELECT "mediaId"::text AS "mediaId"
    FROM "MediaReference"
    WHERE "sourceType" = 'canvas_current' AND "sourceId" IN (${Prisma.join(sourceIds)})
  `);

  if (requestedMediaIds.length) {
    const accessClause = actorUserId === undefined
      ? Prisma.sql`TRUE`
      : Prisma.sql`(
          asset."ownerUserId" = ${actorUserId}
          OR EXISTS (
            SELECT 1 FROM "MediaReference" reference
            WHERE reference."mediaId" = asset."id" AND reference."sourceType" = 'canvas_current'
              AND reference."sourceId" LIKE ${`canvas:${canvasId}:node:%`}
          )
          OR EXISTS (
            SELECT 1 FROM "MediaReference" reference
            JOIN "CanvasSnapshot" snapshot
              ON reference."sourceType" = 'canvas_snapshot'
             AND reference."sourceId" = 'snapshot:' || snapshot."id"::text
            WHERE reference."mediaId" = asset."id" AND snapshot."canvasId" = ${canvasId}
          )
        )`;
    const assets = await tx.$queryRaw<Array<{ id: string; status: string; canUse: boolean; retentionUntil: Date | null }>>(Prisma.sql`
      SELECT asset."id"::text AS "id", asset."status", asset."retentionUntil", ${accessClause} AS "canUse"
      FROM "MediaAsset" asset
      WHERE asset."id" IN (${Prisma.join(requestedMediaIds.map((id) => Prisma.sql`${id}::uuid`))})
      FOR UPDATE
    `);
    const accessibleIds = new Set(assets.filter((asset) => asset.canUse).map((asset) => asset.id.toLowerCase()));
    const forbiddenIds = requestedMediaIds.filter((id) => !accessibleIds.has(id));
    if (forbiddenIds.length) {
      throw new CanvasMediaReferenceError("one or more media assets are not accessible from this canvas", "MEDIA_REFERENCE_FORBIDDEN", 403);
    }
    const readyIds = new Set(assets.filter((asset) => (
      asset.status === "ready"
      || (asset.status === "soft_deleted" && (!asset.retentionUntil || asset.retentionUntil > new Date()))
    )).map((asset) => asset.id.toLowerCase()));
    const invalidIds = requestedMediaIds.filter((id) => !readyIds.has(id));
    if (invalidIds.length) {
      throw new CanvasMediaReferenceError(`media assets are missing or not ready: ${invalidIds.join(", ")}`);
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "MediaAsset" SET "status" = 'ready', "retentionUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" IN (${Prisma.join(requestedMediaIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND "status" = 'soft_deleted'
    `);
  }

  await tx.$executeRaw(Prisma.sql`
    DELETE FROM "MediaReference"
    WHERE "sourceType" = 'canvas_current' AND "sourceId" IN (${Prisma.join(sourceIds)})
  `);
  for (const change of changes) {
    for (const mediaId of change.mediaIds) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "MediaReference" ("mediaId", "sourceType", "sourceId", "createdAt")
        VALUES (${mediaId}::uuid, 'canvas_current', ${change.sourceId}, CURRENT_TIMESTAMP)
        ON CONFLICT ("mediaId", "sourceType", "sourceId") DO NOTHING
      `);
    }
  }
  const affectedMediaIds = [...new Set([...existing.map((item) => item.mediaId.toLowerCase()), ...requestedMediaIds])];
  if (affectedMediaIds.length) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "MediaAsset" asset
      SET "referenceCount" = (
        SELECT COUNT(*)::integer FROM "MediaReference" reference WHERE reference."mediaId" = asset."id"
      ), "updatedAt" = CURRENT_TIMESTAMP
      WHERE asset."id" IN (${Prisma.join(affectedMediaIds.map((id) => Prisma.sql`${id}::uuid`))})
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "MediaAsset" SET "retentionUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" IN (${Prisma.join(affectedMediaIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND "referenceCount" > 0
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "MediaAsset" SET "status" = 'soft_deleted',
        "retentionUntil" = CURRENT_TIMESTAMP + INTERVAL '30 days', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" IN (${Prisma.join(affectedMediaIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND "status" = 'ready' AND "referenceCount" = 0
    `);
  }
}

async function loadProjectionSlice(
  tx: TransactionClient,
  canvasId: number,
  operations: CanvasMutationCommitInput["request"]["operations"],
  settings: CanvasSettings,
) {
  const requirements = collectCanvasProjectionRequirements(operations);
  const edgeClauses: Prisma.Sql[] = [];
  if (requirements.edgeIds.length) {
    edgeClauses.push(Prisma.sql`"edgeId" IN (${Prisma.join(requirements.edgeIds)})`);
  }
  if (requirements.incidentEdgeNodeIds.length) {
    edgeClauses.push(Prisma.sql`"sourceId" IN (${Prisma.join(requirements.incidentEdgeNodeIds)})`);
    edgeClauses.push(Prisma.sql`"targetId" IN (${Prisma.join(requirements.incidentEdgeNodeIds)})`);
  }
  const edgeRows = edgeClauses.length
    ? await tx.$queryRaw<ProjectionEdgeRow[]>(Prisma.sql`
        SELECT "data" FROM "CanvasEdgeState"
        WHERE "canvasId" = ${canvasId} AND (${Prisma.join(edgeClauses, " OR ")})
      `)
    : [];
  const edges = edgeRows.map((row) => row.data as CanvasEdge);
  const endpointIds = edges.flatMap((edge) => [edge.source, edge.target]);
  const nodeIds = [...new Set([...requirements.nodeIds, ...endpointIds])];
  const nodeRows = nodeIds.length
    ? await tx.$queryRaw<ProjectionNodeRow[]>(Prisma.sql`
        SELECT "data" FROM "CanvasNodeState"
        WHERE "canvasId" = ${canvasId} AND "nodeId" IN (${Prisma.join(nodeIds)})
      `)
    : [];
  return { nodes: nodeRows.map((row) => row.data as CanvasNode), edges, settings };
}

async function writeProjectionChanges(
  tx: TransactionClient,
  canvasId: number,
  revision: bigint,
  changes: ReturnType<typeof applyCanvasProjectionOperations>,
  projectionNodes: readonly CanvasNode[],
) {
  if (changes.edgeDeletes.length) {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "CanvasEdgeState"
      WHERE "canvasId" = ${canvasId} AND "edgeId" IN (${Prisma.join(changes.edgeDeletes)})
    `);
  }
  if (changes.nodeDeletes.length) {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "CanvasNodeState"
      WHERE "canvasId" = ${canvasId} AND "nodeId" IN (${Prisma.join(changes.nodeDeletes)})
    `);
  }
  for (const node of changes.nodeUpserts) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CanvasNodeState" (
        "canvasId", "nodeId", "nodeVersion", "kind", "positionX", "positionY",
        "width", "height", "parentId", "zIndex", "data", "searchText", "updatedAt"
      ) VALUES (
        ${canvasId}, ${node.id}, ${revision}, ${node.type}, ${node.position.x}, ${node.position.y},
        ${node.width ?? null}, ${node.height ?? null}, ${node.parentId ?? null}, ${node.zIndex ?? 0},
        ${JSON.stringify(node)}::jsonb, ${nodeSearchText(node)}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("canvasId", "nodeId") DO UPDATE SET
        "nodeVersion" = EXCLUDED."nodeVersion",
        "kind" = EXCLUDED."kind",
        "positionX" = EXCLUDED."positionX",
        "positionY" = EXCLUDED."positionY",
        "width" = EXCLUDED."width",
        "height" = EXCLUDED."height",
        "parentId" = EXCLUDED."parentId",
        "zIndex" = EXCLUDED."zIndex",
        "data" = EXCLUDED."data",
        "searchText" = EXCLUDED."searchText",
        "updatedAt" = CURRENT_TIMESTAMP
    `);
  }
  const nextNodes = [
    ...projectionNodes.filter((node) => !changes.nodeDeletes.includes(node.id) && !changes.nodeUpserts.some((item) => item.id === node.id)),
    ...changes.nodeUpserts,
  ];
  for (const edge of changes.edgeUpserts) {
    const bbox = edgeBbox(edge, nextNodes);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CanvasEdgeState" (
        "canvasId", "edgeId", "edgeVersion", "sourceId", "targetId",
        "bboxMinX", "bboxMinY", "bboxMaxX", "bboxMaxY", "data", "updatedAt"
      ) VALUES (
        ${canvasId}, ${edge.id}, ${revision}, ${edge.source}, ${edge.target},
        ${bbox.minX}, ${bbox.minY}, ${bbox.maxX}, ${bbox.maxY}, ${JSON.stringify(edge)}::jsonb, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("canvasId", "edgeId") DO UPDATE SET
        "edgeVersion" = EXCLUDED."edgeVersion",
        "sourceId" = EXCLUDED."sourceId",
        "targetId" = EXCLUDED."targetId",
        "bboxMinX" = EXCLUDED."bboxMinX",
        "bboxMinY" = EXCLUDED."bboxMinY",
        "bboxMaxX" = EXCLUDED."bboxMaxX",
        "bboxMaxY" = EXCLUDED."bboxMaxY",
        "data" = EXCLUDED."data",
        "updatedAt" = CURRENT_TIMESTAMP
    `);
  }
}

async function commitInTransaction(
  tx: TransactionClient,
  input: CanvasMutationCommitInput,
): Promise<CanvasMutationCommitOutcome> {
  await tx.$queryRaw(Prisma.sql`SELECT set_config('TimeZone', 'UTC', true)`);
  let access = await findAccess(tx, input.canvasId, input.actorUserId);
  if (!access) return { kind: "not_found" };
  if (!access.canEdit) return { kind: "forbidden" };

  const duplicate = await findDuplicate(tx, input.canvasId, input.request.clientMutationId);
  if (duplicate) return { kind: "duplicate", ...duplicate };

  const baseRevision = BigInt(input.request.baseRevision);
  if (access.revision64 !== baseRevision) {
    return conflictOutcome(tx, input.canvasId, baseRevision, access.revision64);
  }
  const updated = await tx.$queryRaw<Array<{ revision64: bigint }>>(Prisma.sql`
    UPDATE "Canvas" canvas
    SET "revision64" = canvas."revision64" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE canvas."id" = ${input.canvasId}
      AND canvas."deletedAt" IS NULL
      AND canvas."revision64" = ${baseRevision}
      AND (
        canvas."authUserId" = ${input.actorUserId}
        OR EXISTS (
          SELECT 1 FROM "CanvasMember" member
          WHERE member."canvasId" = canvas."id"
            AND member."userId" = ${input.actorUserId}
            AND member."role" IN ('OWNER', 'EDITOR')
        )
      )
    RETURNING canvas."revision64"
  `);
  if (!updated[0]) {
    const racedDuplicate = await findDuplicate(tx, input.canvasId, input.request.clientMutationId);
    if (racedDuplicate) return { kind: "duplicate", ...racedDuplicate };
    access = await findAccess(tx, input.canvasId, input.actorUserId);
    if (!access) return { kind: "not_found" };
    if (!access.canEdit) return { kind: "forbidden" };
    return conflictOutcome(tx, input.canvasId, baseRevision, access.revision64);
  }
  const revision = updated[0].revision64;

  let bootstrap: Awaited<ReturnType<typeof initializeProjection>> | null = null;
  if (access.projectionRevision === BigInt(0)) {
    bootstrap = await initializeProjection(tx, input.canvasId, baseRevision);
    access = { ...access, projectionRevision: baseRevision, nodeCount: bootstrap.nodes.length, edgeCount: bootstrap.edges.length, settings: bootstrap.settings };
  }
  if (access.projectionRevision !== baseRevision) {
    throw new CanvasProjectionStateError(
      `projection revision ${access.projectionRevision.toString()} does not match canvas revision ${baseRevision.toString()}`,
    );
  }

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "CanvasMutation" (
      "canvasId", "actorUserId", "clientMutationId", "clientSequence", "payloadHash",
      "baseRevision", "revision", "protocolVersion", "operations", "touchedPaths", "createdAt"
    ) VALUES (
      ${input.canvasId}, ${input.actorUserId}, ${input.request.clientMutationId}::uuid,
      ${BigInt(input.request.clientSequence)}, ${input.payloadHash}, ${baseRevision}, ${revision},
      ${input.request.protocolVersion}, ${JSON.stringify(input.request.operations)}::jsonb,
      ${JSON.stringify(input.touchedPaths)}::jsonb, CURRENT_TIMESTAMP
    )
  `);

  const settings = bootstrap?.settings ?? parseSettings(access.settings);
  if (!settings) throw new CanvasProjectionStateError("canvas projection settings are invalid");
  const slice = bootstrap
    ? bootstrap
    : await loadProjectionSlice(tx, input.canvasId, input.request.operations, settings);
  const changes = applyCanvasProjectionOperations(slice, input.request.operations);
  const nextNodeCount = access.nodeCount + changes.nodeCountDelta;
  const nextEdgeCount = access.edgeCount + changes.edgeCountDelta;
  if (nextNodeCount > CANVAS_MAX_NODES) throw new CanvasLimitError("CANVAS_NODE_LIMIT", `canvas exceeds ${CANVAS_MAX_NODES} nodes`);
  if (nextEdgeCount > CANVAS_MAX_EDGES) throw new CanvasLimitError("CANVAS_EDGE_LIMIT", `canvas exceeds ${CANVAS_MAX_EDGES} edges`);

  await writeProjectionChanges(tx, input.canvasId, revision, changes, slice.nodes);
  await syncCanvasCurrentMediaReferences(tx, input.canvasId, changes.nodeUpserts, changes.nodeDeletes, input.actorUserId);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Canvas"
    SET
      "projectionRevision" = ${revision},
      "nodeCount" = "nodeCount" + ${changes.nodeCountDelta},
      "edgeCount" = "edgeCount" + ${changes.edgeCountDelta},
      "settings" = ${JSON.stringify(changes.settings)}::jsonb,
      "thumbnail" = (
        SELECT candidate."url"
        FROM (
          SELECT
            CASE
              WHEN node."kind" = 'image' THEN COALESCE(
                node."data"#>>'{data,variants,thumbnail,url}',
                node."data"#>>'{data,variants,preview,url}',
                node."data"#>>'{data,variants,original,url}',
                node."data"#>>'{data,url}'
              )
              WHEN node."kind" = 'imageTask' THEN (
                SELECT output.value->>'url'
                FROM jsonb_array_elements(COALESCE(node."data"#>'{data,task,batches}', '[]'::jsonb))
                  WITH ORDINALITY AS batch(value, ordinal)
                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(batch.value->'outputs', '[]'::jsonb))
                  WITH ORDINALITY AS output(value, ordinal)
                WHERE output.value->>'status' = 'success'
                  AND COALESCE(output.value->>'url', '') <> ''
                ORDER BY batch.ordinal DESC, output.ordinal ASC
                LIMIT 1
              )
              WHEN node."kind" = 'video' THEN COALESCE(
                node."data"#>>'{data,posterUrl}',
                node."data"#>>'{data,variants,thumbnail,url}',
                node."data"#>>'{data,variants,preview,url}',
                node."data"#>>'{data,variants,poster,url}'
              )
              WHEN node."kind" = 'compare' THEN node."data"#>>'{data,beforeUrl}'
              ELSE NULL
            END AS "url",
            node."positionY",
            node."positionX",
            node."nodeId"
          FROM "CanvasNodeState" node
          WHERE node."canvasId" = ${input.canvasId}
        ) candidate
        WHERE candidate."url" IS NOT NULL AND candidate."url" <> ''
        ORDER BY candidate."positionY" ASC, candidate."positionX" ASC, candidate."nodeId" ASC
        LIMIT 1
      )
    WHERE "id" = ${input.canvasId}
  `);
  return { kind: "applied", revision };
}

export function createPrismaCanvasMutationStore(client: PrismaClient): CanvasMutationStore {
  return {
    commit(input) {
      return client.$transaction((tx) => commitInTransaction(tx, input), {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 15000,
      });
    },
  };
}

export type CanvasMutationPageResult =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | {
      kind: "ok";
      currentRevision: string;
      hasMore: boolean;
      items: Array<{
        revision: string;
        protocolVersion: number;
        operations: unknown;
        touchedPaths: string[];
        createdAt: Date;
      }>;
    };

export async function readCanvasMutationPage(
  client: PrismaClient,
  input: { canvasId: number; actorUserId: number; afterRevision: bigint; limit?: number },
): Promise<CanvasMutationPageResult> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
  const accessRows = await client.$queryRaw<Array<{ revision64: bigint; canView: boolean }>>(Prisma.sql`
    SELECT
      canvas."revision64",
      (
        canvas."authUserId" = ${input.actorUserId}
        OR EXISTS (
          SELECT 1 FROM "CanvasMember" member
          WHERE member."canvasId" = canvas."id"
            AND member."userId" = ${input.actorUserId}
            AND member."role" IN ('OWNER', 'EDITOR', 'VIEWER')
        )
      ) AS "canView"
    FROM "Canvas" canvas
    WHERE canvas."id" = ${input.canvasId} AND canvas."deletedAt" IS NULL
    LIMIT 1
  `);
  const access = accessRows[0];
  if (!access) return { kind: "not_found" };
  if (!access.canView) return { kind: "forbidden" };
  const rows = await client.$queryRaw<Array<StoredMutationRow & { createdAt: Date }>>(Prisma.sql`
    SELECT "revision", "protocolVersion", "operations", "touchedPaths", "createdAt"
    FROM "CanvasMutation"
    WHERE "canvasId" = ${input.canvasId} AND "revision" > ${input.afterRevision}
    ORDER BY "revision" ASC
    LIMIT ${limit + 1}
  `);
  return {
    kind: "ok",
    currentRevision: access.revision64.toString(),
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map((row) => ({
      revision: row.revision.toString(),
      protocolVersion: row.protocolVersion,
      operations: row.operations,
      touchedPaths: asStringArray(row.touchedPaths),
      createdAt: row.createdAt,
    })),
  };
}

type BootstrapAccessRow = {
  revision64: bigint;
  projectionRevision: bigint;
  title: string;
  settings: unknown;
  viewport: unknown;
  canView: boolean;
};

export type CanvasBootstrapPageResult =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "conflict"; currentRevision: string }
  | {
      kind: "ok";
      title: string;
      revision: string;
      projectionRevision: string;
      notModified?: boolean;
      documentSchemaVersion: 2;
      operationProtocolVersion: 1;
      settings: CanvasSettings;
      viewport: { x: number; y: number; zoom: number };
      nodes: CanvasNode[];
      edges: CanvasEdge[];
      nextNodeCursor: string | null;
      nextEdgeCursor: string | null;
    };

function parseViewport(value: unknown): { x: number; y: number; zoom: number } {
  if (!value || typeof value !== "object") return { x: 0, y: 0, zoom: 1 };
  const item = value as Record<string, unknown>;
  return Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.zoom) && Number(item.zoom) > 0
    ? { x: Number(item.x), y: Number(item.y), zoom: Number(item.zoom) }
    : { x: 0, y: 0, zoom: 1 };
}

async function bootstrapPageInTransaction(
  tx: TransactionClient,
  input: {
    canvasId: number;
    actorUserId: number;
    readOnly?: boolean;
    baseRevision?: bigint;
    knownRevision?: bigint;
    nodeIds?: string[];
    nodeCursor?: string;
    edgeCursor?: string;
    limit: number;
  },
): Promise<CanvasBootstrapPageResult> {
  const accessRows = await tx.$queryRaw<BootstrapAccessRow[]>(Prisma.sql`
    SELECT
      canvas."revision64",
      canvas."projectionRevision",
      canvas."title",
      canvas."settings",
      canvas."data"->'viewport' AS "viewport",
      (
        canvas."authUserId" = ${input.actorUserId}
        OR EXISTS (
          SELECT 1 FROM "CanvasMember" member
          WHERE member."canvasId" = canvas."id"
            AND member."userId" = ${input.actorUserId}
            AND member."role" IN ('OWNER', 'EDITOR', 'VIEWER')
        )
      ) AS "canView"
    FROM "Canvas" canvas
    WHERE canvas."id" = ${input.canvasId} AND canvas."deletedAt" IS NULL
    LIMIT 1
  `);
  let access = accessRows[0];
  if (!access) return { kind: "not_found" };
  if (!access.canView) return { kind: "forbidden" };
  if (input.baseRevision !== undefined && input.baseRevision !== access.revision64) {
    return { kind: "conflict", currentRevision: access.revision64.toString() };
  }

  if (input.readOnly && access.projectionRevision === BigInt(0)) {
    // Viewing legacy canvases must not initialize projections or acquire an editor session.
    const rows = await tx.$queryRaw<Array<{ data: unknown }>>(Prisma.sql`SELECT "data" FROM "Canvas" WHERE "id" = ${input.canvasId}`);
    const document = parseCanvasDocumentV2(rows[0]?.data);
    const nodes = document.nodes.filter(node => (!input.nodeIds || input.nodeIds.includes(node.id)) && (!input.nodeCursor || node.id > input.nodeCursor)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const edges = (input.nodeIds ? [] : document.edges).filter(edge => !input.edgeCursor || edge.id > input.edgeCursor).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return {
      kind: "ok", title: access.title, revision: access.revision64.toString(), projectionRevision: "0",
      documentSchemaVersion: 2, operationProtocolVersion: 1, settings: document.settings, viewport: document.viewport,
      nodes: nodes.slice(0, input.limit), edges: edges.slice(0, input.limit),
      nextNodeCursor: nodes.length > input.limit ? nodes[input.limit - 1].id : null,
      nextEdgeCursor: edges.length > input.limit ? edges[input.limit - 1].id : null,
    };
  }
  if (access.projectionRevision === BigInt(0)) {
    const locked = await tx.$queryRaw<BootstrapAccessRow[]>(Prisma.sql`
      SELECT
        canvas."revision64",
        canvas."projectionRevision",
        canvas."title",
        canvas."settings",
        canvas."data"->'viewport' AS "viewport",
        TRUE AS "canView"
      FROM "Canvas" canvas
      WHERE canvas."id" = ${input.canvasId} AND canvas."deletedAt" IS NULL
      FOR UPDATE
    `);
    access = locked[0] ?? access;
    if (input.baseRevision !== undefined && input.baseRevision !== access.revision64) {
      return { kind: "conflict", currentRevision: access.revision64.toString() };
    }
    if (access.projectionRevision === BigInt(0)) {
      const initialized = await initializeProjection(tx, input.canvasId, access.revision64);
      access = { ...access, projectionRevision: access.revision64, settings: initialized.settings };
    }
  }
  if (access.projectionRevision !== access.revision64) {
    throw new CanvasProjectionStateError("canvas projection is not caught up to the current revision");
  }
  // Access and projection consistency are checked even when the browser has a snapshot.
  if (input.knownRevision === access.revision64 && !input.nodeCursor && !input.edgeCursor) {
    const settings = parseSettings(access.settings);
    if (!settings) throw new CanvasProjectionStateError("canvas projection settings are invalid");
    return { kind: "ok", notModified: true, title: access.title, revision: access.revision64.toString(), projectionRevision: access.projectionRevision.toString(), documentSchemaVersion: 2, operationProtocolVersion: 1, settings, viewport: parseViewport(access.viewport), nodes: [], edges: [], nextNodeCursor: null, nextEdgeCursor: null };
  }
  const nodeCursorClause = input.nodeCursor
    ? Prisma.sql`AND "nodeId" > ${input.nodeCursor}`
    : Prisma.empty;
  const edgeCursorClause = input.edgeCursor
    ? Prisma.sql`AND "edgeId" > ${input.edgeCursor}`
    : Prisma.empty;
  const nodeRows = await tx.$queryRaw<Array<{ nodeId: string; data: unknown }>>(Prisma.sql`
    SELECT "nodeId", "data"
    FROM "CanvasNodeState"
    WHERE "canvasId" = ${input.canvasId} ${nodeCursorClause} ${input.nodeIds ? input.nodeIds.length ? Prisma.sql`AND "nodeId" IN (${Prisma.join(input.nodeIds)})` : Prisma.sql`AND FALSE` : Prisma.empty}
    ORDER BY "nodeId" ASC
    LIMIT ${input.limit + 1}
  `);
  const edgeRows = input.nodeIds ? [] : await tx.$queryRaw<Array<{ edgeId: string; data: unknown }>>(Prisma.sql`
    SELECT "edgeId", "data"
    FROM "CanvasEdgeState"
    WHERE "canvasId" = ${input.canvasId} ${edgeCursorClause}
    ORDER BY "edgeId" ASC
    LIMIT ${input.limit + 1}
  `);
  const settings = parseSettings(access.settings);
  if (!settings) throw new CanvasProjectionStateError("canvas projection settings are invalid");
  const nodes = nodeRows.slice(0, input.limit);
  const edges = edgeRows.slice(0, input.limit);
  return {
    kind: "ok",
    title: access.title,
    revision: access.revision64.toString(),
    projectionRevision: access.projectionRevision.toString(),
    documentSchemaVersion: 2,
    operationProtocolVersion: 1,
    settings,
    viewport: parseViewport(access.viewport),
    nodes: nodes.map((row) => row.data as CanvasNode),
    edges: edges.map((row) => row.data as CanvasEdge),
    nextNodeCursor: nodeRows.length > input.limit ? nodes.at(-1)?.nodeId ?? null : null,
    nextEdgeCursor: edgeRows.length > input.limit ? edges.at(-1)?.edgeId ?? null : null,
  };
}

export function readCanvasBootstrapPage(
  client: PrismaClient,
  input: {
    canvasId: number;
    actorUserId: number;
    readOnly?: boolean;
    baseRevision?: bigint;
    knownRevision?: bigint;
    nodeIds?: string[];
    nodeCursor?: string;
    edgeCursor?: string;
    limit?: number;
  },
): Promise<CanvasBootstrapPageResult> {
  return client.$transaction(
    (tx) => bootstrapPageInTransaction(tx, { ...input, limit: Math.min(Math.max(input.limit ?? 500, 1), 1000) }),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5000,
      timeout: 15000,
    },
  );
}
