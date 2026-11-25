import "server-only";

import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeMediaUrl } from "@/lib/media-url";
import { prepareCanvasPreviews } from "./prepare-previews";

function inferKind(type: string, path: string) {
  if (type.includes("video") || /\.(mp4|mov|webm|mkv)(?:[?#]|$)/i.test(path)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg)(?:[?#]|$)/i.test(path)) return "audio";
  return "image";
}

export async function getOrCreateGenerationMediaAsset(
  client: PrismaClient,
  generation: { id: number; authUserId: number | null; type: string; localPath: string },
) {
  const sourceId = `generation:${generation.id}:0`;
  const result = await client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(9122026, ${generation.id}::int)`);
    const existing = await tx.$queryRaw<Array<{ id: string; publicUrl: string | null }>>(Prisma.sql`
      SELECT asset."id"::text AS "id", asset."publicUrl"
      FROM "MediaReference" reference
      JOIN "MediaAsset" asset ON asset."id" = reference."mediaId"
      WHERE reference."sourceType" = 'generation' AND reference."sourceId" = ${sourceId}
        AND asset."status" = 'ready'
      LIMIT 1
    `);
    if (existing[0]) return { mediaId: existing[0].id, url: existing[0].publicUrl || normalizeMediaUrl(generation.localPath) };

    const mediaId = crypto.randomUUID();
    const url = normalizeMediaUrl(generation.localPath);
    const kind = inferKind(generation.type, generation.localPath);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "MediaAsset" (
        "id", "ownerUserId", "kind", "status", "storageProvider", "originalKey", "publicUrl",
        "variants", "metadata", "referenceCount", "createdAt", "updatedAt"
      ) VALUES (
        ${mediaId}::uuid, ${generation.authUserId}, ${kind}, 'ready', 'generation', ${generation.localPath}, ${url},
        ${JSON.stringify({ original: { mediaId, url } })}::jsonb,
        ${JSON.stringify({ generationId: generation.id })}::jsonb, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "MediaReference" ("mediaId", "sourceType", "sourceId", "createdAt")
      VALUES (${mediaId}::uuid, 'generation', ${sourceId}, CURRENT_TIMESTAMP)
    `);
    return { mediaId, url };
  });
  await prepareCanvasPreviews(result.url).catch(() => undefined);
  return result;
}
