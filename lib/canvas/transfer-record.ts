import type { Canvas, Prisma } from "@prisma/client";
import { parseCanvasDocumentV2 } from "./document";
import { randomUUID } from "node:crypto";

/** Call inside a RepeatableRead transaction so metadata and projection agree. */
export async function materializeCanvasTransferRecord(tx: Prisma.TransactionClient, canvas: Canvas): Promise<Canvas> {
  if (canvas.projectionRevision === BigInt(0)) return { ...canvas, snapshotRevision: BigInt(0), currentSnapshotId: null };
  if (canvas.projectionRevision !== canvas.revision64) throw new Error("画布投影版本不一致，不能复制或导出");
  const [nodes, edges] = await Promise.all([
    tx.canvasNodeState.findMany({ where: { canvasId: canvas.id }, orderBy: { nodeId: "asc" }, select: { data: true } }),
    tx.canvasEdgeState.findMany({ where: { canvasId: canvas.id }, orderBy: { edgeId: "asc" }, select: { data: true } }),
  ]);
  if (nodes.length !== canvas.nodeCount || edges.length !== canvas.edgeCount) throw new Error("画布节点或连线不完整，不能复制或导出");
  const legacy = canvas.data as Record<string, Prisma.JsonValue>;
  const document = parseCanvasDocumentV2({
    schemaVersion: 2, mode: "smart", nodes: nodes.map(row => row.data), edges: edges.map(row => row.data),
    settings: canvas.settings, viewport: legacy.viewport ?? { x: 0, y: 0, zoom: 1 },
  });
  return {
    ...canvas, data: document as unknown as Prisma.JsonObject,
    // The self-contained document initializes fresh projections on first access.
    projectionRevision: BigInt(0), snapshotRevision: BigInt(0), currentSnapshotId: null,
  };
}

export async function restoreCanvasMediaAssets(tx: Prisma.TransactionClient, rows: Array<Record<string, any>>, ownerUserId: number, ids: Map<string, string>) {
  for (const row of rows) {
    if (typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id)) throw new Error("画布媒体标识无效");
    const existing = await tx.mediaAsset.findUnique({ where: { id: row.id }, select: { id: true, ownerUserId: true } });
    const id = !existing || existing.ownerUserId === ownerUserId ? row.id : randomUUID();
    ids.set(row.id, id);
    if (existing?.ownerUserId === ownerUserId) continue;
    await tx.mediaAsset.create({ data: {
      id, ownerUserId, kind: row.kind, status: row.status === "soft_deleted" ? "ready" : row.status,
      originalName: row.originalName, declaredMime: row.declaredMime, detectedMime: row.detectedMime,
      sizeBytes: row.sizeBytes == null ? null : BigInt(row.sizeBytes), checksumSha256: row.checksumSha256,
      storageProvider: row.storageProvider, originalKey: row.originalKey, publicUrl: row.publicUrl,
      variants: row.variants, metadata: row.metadata,
      ...(row.createdAt ? { createdAt: new Date(row.createdAt) } : {}),
      // References are rebuilt from restored canvases, never copied as counters.
      referenceCount: 0, retentionUntil: null,
    } });
  }
}

export function prepareCanvasArchiveRows(rows: Array<Record<string, any> & { id: number }>, mediaIds: Map<string, string>) {
  const remap = (value: any): any => {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      key === "mediaId" && typeof item === "string" ? mediaIds.get(item) ?? item : remap(item),
    ]));
  };
  return rows.map(row => {
    // Old archives with a live projection revision did not contain its content.
    if (BigInt(row.projectionRevision ?? 0) !== BigInt(0)) throw new Error("旧归档缺少画布最新投影，请使用修复后的版本重新导出");
    return { ...row, data: remap(row.data), revision64: BigInt(row.revision64 ?? row.revision ?? 1),
      projectionRevision: BigInt(0), snapshotRevision: BigInt(0), currentSnapshotId: null };
  });
}
