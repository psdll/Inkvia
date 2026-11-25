import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { getUserId } from "@/lib/server-auth";
import { prisma } from "@/lib/prisma";
import { withPersonalMaterial } from "@/lib/canvas/personal-library";
import { persistCanvasMediaStream } from "@/lib/canvas/media-upload-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserId(req); if (!user) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
  try {
    const media = await withPersonalMaterial(user, params.id, (item, file) => persistCanvasMediaStream(prisma, { ownerUserId: user, stream: createReadStream(file), originalName: item.name, declaredMime: item.mime, kind: item.kind }));
    return NextResponse.json({ success: true, media });
  } catch (e) { return NextResponse.json({ error: apiErrorMessage((e as Error).message) }, { status: 400 }); }
}
