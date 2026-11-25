import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { canvasImportUserPrefix, normalizeCanvasImportRef } from "@/lib/canvas/import-refs";
import type { CanvasUndoMediaRef } from "@/lib/canvas/undo-media";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";

export const CANVAS_UNDO_HOLD_MS = 10 * 60 * 1000;
export const CANVAS_UNDO_HOLD_MAX_REFS = 500;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type HoldRow = {
  id: bigint;
  referenceKey: string;
  mediaId: string | null;
  publicRef: string | null;
};

type NormalizedHold = {
  referenceKey: string;
  mediaId: string | null;
  publicRef: string | null;
};

function uniqueMediaIds(refs: readonly CanvasUndoMediaRef[]) {
  return [...new Set(
    refs
      .map((ref) => String(ref.mediaId || "").trim().toLowerCase())
      .filter((mediaId) => UUID_PATTERN.test(mediaId)),
  )];
}

function uniqueImportRefs(refs: readonly CanvasUndoMediaRef[], ownerUserId: number) {
  const prefix = canvasImportUserPrefix(ownerUserId);
  return [...new Set(
    refs
      .map((ref) => normalizeCanvasImportRef(ref.publicRef))
      .filter((publicRef) => publicRef.startsWith(prefix)),
  )];
}

async function normalizeHolds(
  tx: Prisma.TransactionClient,
  input: {
    canvasId: number;
    ownerUserId: number;
    refs: readonly CanvasUndoMediaRef[];
  },
): Promise<NormalizedHold[]> {
  const refs = input.refs.slice(0, CANVAS_UNDO_HOLD_MAX_REFS);
  const mediaIds = uniqueMediaIds(refs);
  const importRefs = uniqueImportRefs(refs, input.ownerUserId);
  const mediaRows = mediaIds.length || importRefs.length
    ? await tx.$queryRaw<Array<{ id: string; publicUrl: string | null }>>(Prisma.sql`
        SELECT asset."id"::text AS "id", asset."publicUrl"
        FROM "MediaAsset" asset
        WHERE (
          ${mediaIds.length
            ? Prisma.sql`asset."id" IN (${Prisma.join(mediaIds.map((mediaId) => Prisma.sql`${mediaId}::uuid`))})`
            : Prisma.sql`FALSE`}
          OR
          ${importRefs.length
            ? Prisma.sql`asset."publicUrl" IN (${Prisma.join(importRefs)})`
            : Prisma.sql`FALSE`}
        )
        AND (
          asset."ownerUserId" = ${input.ownerUserId}
          OR EXISTS (
            SELECT 1 FROM "MediaReference" reference
            WHERE reference."mediaId" = asset."id"
              AND reference."sourceType" = 'canvas_current'
              AND reference."sourceId" LIKE ${`canvas:${input.canvasId}:node:%`}
          )
        )
      `)
    : [];
  const mediaById = new Map(mediaRows.map((row) => [row.id.toLowerCase(), row]));
  const mediaByUrl = new Map(
    mediaRows
      .filter((row): row is { id: string; publicUrl: string } => Boolean(row.publicUrl))
      .map((row) => [normalizeCanvasImportRef(row.publicUrl), row]),
  );
  const normalized = new Map<string, NormalizedHold>();

  for (const mediaId of mediaIds) {
    const media = mediaById.get(mediaId);
    if (!media) continue;
    const referenceKey = `media:${mediaId}`;
    normalized.set(referenceKey, {
      referenceKey,
      mediaId,
      publicRef: media.publicUrl,
    });
  }
  for (const publicRef of importRefs) {
    const media = mediaByUrl.get(publicRef);
    const referenceKey = `url:${publicRef}`;
    normalized.set(referenceKey, {
      referenceKey,
      mediaId: media?.id.toLowerCase() || null,
      publicRef,
    });
  }

  return [...normalized.values()].sort((left, right) => left.referenceKey.localeCompare(right.referenceKey));
}

async function cleanupReleasedRefs(refs: readonly string[]) {
  const unique = [...new Set(refs.map(String).map((ref) => ref.trim()).filter(Boolean))];
  if (!unique.length) return;
  await deleteStoredMediaRefs(unique);
}

export async function syncCanvasUndoMediaHolds(
  client: PrismaClient,
  input: {
    undoSessionId: string;
    canvasId: number;
    ownerUserId: number;
    refs: readonly CanvasUndoMediaRef[];
    currentRefs?: readonly CanvasUndoMediaRef[];
    now?: Date;
  },
): Promise<{ held: number; releasedRefs: string[] }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + CANVAS_UNDO_HOLD_MS);
  const result = await client.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<HoldRow[]>(Prisma.sql`
      SELECT "id", "referenceKey", "mediaId"::text AS "mediaId", "publicRef"
      FROM "CanvasUndoMediaHold"
      WHERE "undoSessionId" = ${input.undoSessionId}::uuid
        AND "canvasId" = ${input.canvasId}
        AND "ownerUserId" = ${input.ownerUserId}
      FOR UPDATE
    `);
    const [holds, current] = await Promise.all([
      normalizeHolds(tx, input),
      normalizeHolds(tx, { ...input, refs: input.currentRefs || [] }),
    ]);
    const nextKeys = new Set(holds.map((hold) => hold.referenceKey));
    const currentKeys = new Set(current.map((hold) => hold.referenceKey));
    const releasedRefs = existing
      .filter((hold) => !nextKeys.has(hold.referenceKey) && !currentKeys.has(hold.referenceKey))
      .map((hold) => hold.mediaId === null ? hold.publicRef : null)
      .filter((ref): ref is string => Boolean(ref));

    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "CanvasUndoMediaHold"
      WHERE "undoSessionId" = ${input.undoSessionId}::uuid
        AND "canvasId" = ${input.canvasId}
        AND "ownerUserId" = ${input.ownerUserId}
    `);
    if (holds.length) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CanvasUndoMediaHold" (
          "undoSessionId", "canvasId", "ownerUserId", "referenceKey",
          "mediaId", "publicRef", "expiresAt", "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(holds.map((hold) => Prisma.sql`(
          ${input.undoSessionId}::uuid,
          ${input.canvasId},
          ${input.ownerUserId},
          ${hold.referenceKey},
          ${hold.mediaId}::uuid,
          ${hold.publicRef},
          ${expiresAt},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )`))}
      `);
    }
    return { held: holds.length, releasedRefs };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 15_000,
  });
  await cleanupReleasedRefs(result.releasedRefs);
  return result;
}

export async function releaseCanvasUndoMediaHolds(
  client: PrismaClient,
  input: {
    undoSessionId: string;
    canvasId: number;
    ownerUserId: number;
    currentRefs?: readonly CanvasUndoMediaRef[];
  },
): Promise<{ releasedRefs: string[] }> {
  const releasedRefs = await client.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<HoldRow[]>(Prisma.sql`
      SELECT "id", "referenceKey", "mediaId"::text AS "mediaId", "publicRef"
      FROM "CanvasUndoMediaHold"
      WHERE "undoSessionId" = ${input.undoSessionId}::uuid
        AND "canvasId" = ${input.canvasId}
        AND "ownerUserId" = ${input.ownerUserId}
      FOR UPDATE
    `);
    const current = await normalizeHolds(tx, {
      canvasId: input.canvasId,
      ownerUserId: input.ownerUserId,
      refs: input.currentRefs || [],
    });
    const currentKeys = new Set(current.map((hold) => hold.referenceKey));
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "CanvasUndoMediaHold"
      WHERE "undoSessionId" = ${input.undoSessionId}::uuid
        AND "canvasId" = ${input.canvasId}
        AND "ownerUserId" = ${input.ownerUserId}
    `);
    return existing
      .filter((hold) => !currentKeys.has(hold.referenceKey))
      .map((hold) => hold.mediaId === null ? hold.publicRef : null)
      .filter((ref): ref is string => Boolean(ref));
  });
  await cleanupReleasedRefs(releasedRefs);
  return { releasedRefs };
}

export async function cleanupExpiredCanvasUndoMediaHolds(
  client: PrismaClient,
  now = new Date(),
  limit = 500,
): Promise<{ deletedHolds: number; releasedRefs: string[] }> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 2_000);
  const rows = await client.$transaction(async (tx) => {
    const expired = await tx.$queryRaw<HoldRow[]>(Prisma.sql`
      SELECT "id", "referenceKey", "mediaId"::text AS "mediaId", "publicRef"
      FROM "CanvasUndoMediaHold"
      WHERE "expiresAt" <= ${now}
      ORDER BY "expiresAt" ASC
      LIMIT ${boundedLimit}
      FOR UPDATE SKIP LOCKED
    `);
    if (expired.length) {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "CanvasUndoMediaHold"
        WHERE "id" IN (${Prisma.join(expired.map((hold) => hold.id))})
      `);
    }
    return expired;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 15_000,
  });
  const releasedRefs = rows
    .map((hold) => hold.mediaId === null ? hold.publicRef : null)
    .filter((ref): ref is string => Boolean(ref));
  await cleanupReleasedRefs(releasedRefs);
  return { deletedHolds: rows.length, releasedRefs };
}
