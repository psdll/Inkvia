import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { materializeCanvasTransferRecord, prepareCanvasArchiveRows, restoreCanvasMediaAssets } from "@/lib/canvas/transfer-record";
import { readCanvasBootstrapPage, syncCanvasCurrentMediaReferences } from "@/lib/canvas/prisma-mutation-store";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const integrationIt = process.env.RUN_CANVAS_TRANSFER_DB_TEST === "1" ? it : it.skip;

integrationIt("copies and restores latest projected content, media and large revisions in PostgreSQL", async () => {
  const rollback = new Error("rollback audit fixtures");
  await expect(prisma.$transaction(async tx => {
    const owner = await tx.user.create({ data: { username: `audit-${randomUUID()}`, password: "unused" } });
    const recipient = await tx.user.create({ data: { username: `audit-${randomUUID()}`, password: "unused" } });
    const media = await tx.mediaAsset.create({ data: { ownerUserId: owner.id, kind: "image", status: "ready", publicUrl: "/uploads/audit.png", sizeBytes: BigInt(42) } });
    const revision = BigInt("9007199254740993");
    const node = { id: "latest", type: "image", position: { x: 123, y: 456 }, data: { kind: "image", url: "/uploads/audit.png", mediaId: media.id } };
    const source = await tx.canvas.create({ data: { authUserId: owner.id, title: "audit", data: createEmptyCanvasDocumentV2(), settings: createEmptyCanvasDocumentV2().settings, revision64: revision, projectionRevision: revision, nodeCount: 1 } });
    await tx.canvasNodeState.create({ data: { canvasId: source.id, nodeId: node.id, nodeVersion: revision, kind: node.type, positionX: 123, positionY: 456, data: node } });
    const complete = await materializeCanvasTransferRecord(tx, source);
    const doc = complete.data as any;
    expect(doc.nodes).toEqual([node]);
    const copy = await tx.canvas.create({ data: { authUserId: owner.id, title: "copy", data: complete.data as any } });
    await syncCanvasCurrentMediaReferences(tx, copy.id, doc.nodes, [], owner.id);
    const archive = JSON.parse(JSON.stringify({ canvases: [complete], assets: [media] }, (_, value) => typeof value === "bigint" ? String(value) : value));
    const mediaIds = new Map<string, string>();
    await restoreCanvasMediaAssets(tx, archive.assets, recipient.id, mediaIds);
    expect(mediaIds.get(media.id)).not.toBe(media.id);
    const [restored] = prepareCanvasArchiveRows(archive.canvases, mediaIds);
    const { id, publicId, authUserId, ...data } = restored as Record<string, any>;
    const imported = await tx.canvas.create({ data: { ...data, authUserId: recipient.id } as any });
    await syncCanvasCurrentMediaReferences(tx, imported.id, restored.data.nodes, [], recipient.id);
    const client = { $transaction: (callback: (db: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient;
    expect(await readCanvasBootstrapPage(client, { canvasId: copy.id, actorUserId: owner.id })).toMatchObject({ kind: "ok", nodes: [node] });
    expect(await readCanvasBootstrapPage(client, { canvasId: imported.id, actorUserId: recipient.id })).toMatchObject({ kind: "ok", nodes: [{ ...node, data: { ...node.data, mediaId: mediaIds.get(media.id) } }] });
    expect((await tx.canvas.findUniqueOrThrow({ where: { id: imported.id } })).revision64).toBe(revision);
    expect((await tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaIds.get(media.id) } })).referenceCount).toBe(1);
    throw rollback;
  }, { isolationLevel: "RepeatableRead", timeout: 20000 })).rejects.toBe(rollback);
});
