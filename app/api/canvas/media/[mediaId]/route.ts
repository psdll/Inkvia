import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { normalizeMediaUrl } from "@/lib/media-url";
import { buildCreativeAgentMediaTask } from "@/lib/creative-agent/media-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: { mediaId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false }, { status: 401 });
  if (!UUID_PATTERN.test(params.mediaId)) {
    return NextResponse.json({ success: false, error: "media not found" }, { status: 404 });
  }
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    status: string;
    kind: string;
    publicUrl: string | null;
    variants: unknown;
    metadata: unknown;
    failureCode: string | null;
    failureMessage: string | null;
  }>>(Prisma.sql`
    SELECT "id"::text AS "id", "status", "kind", "publicUrl", "variants", "metadata", "failureCode", "failureMessage"
    FROM "MediaAsset"
    WHERE "id" = ${params.mediaId}::uuid AND "ownerUserId" = ${authUserId}
    LIMIT 1
  `).catch(() => []);
  if (!rows[0]) return NextResponse.json({ success: false, error: "media not found" }, { status: 404 });
  const { metadata, ...media } = rows[0];
  const generationId = metadata && typeof metadata === "object" && "generationId" in metadata ? metadata.generationId : undefined;
  if (req.nextUrl.searchParams.get("generation") === "1" && media.status === "ready" && typeof generationId === "number" && Number.isSafeInteger(generationId) && generationId > 0) {
    const row = await prisma.generation.findFirst({
      where: { id: generationId, authUserId, source: "agent", status: "success" },
      select: { id: true, canvasId: true, type: true, model: true, prompt: true, templateData: true, requestKey: true, createdAt: true, localPath: true },
    });
    if (row?.canvasId && row.localPath && normalizeMediaUrl(row.localPath) === media.publicUrl
      && ((row.type === "image_edit" && media.kind === "image") || (row.type === "video_gen" && media.kind === "video"))) {
      return NextResponse.json({ success: true, ...media, generationCanvasId: row.canvasId,
        generationTask: buildCreativeAgentMediaTask(row, { mediaId: media.id, url: media.publicUrl! }) });
    }
  }
  return NextResponse.json({ success: true, ...media });
}
