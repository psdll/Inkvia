import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";

function parseTemplateData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
  }

  const generationId = Number(params.id);
  if (!Number.isFinite(generationId) || generationId <= 0) {
    return NextResponse.json({ success: false, error: apiMessage("mbb035996af1c") }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { templateData?: unknown } | null;
  const templateData = parseTemplateData(body?.templateData);
  if (!templateData) {
    return NextResponse.json({ success: false, error: apiMessage("m4d82456066f4") }, { status: 400 });
  }

  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    select: { id: true, authUserId: true, type: true }
  });
  if (!generation) {
    return NextResponse.json({ success: false, error: apiMessage("m9b4842275331") }, { status: 404 });
  }
  if (generation.authUserId !== authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m49f16fca957a") }, { status: 403 });
  }

  const nextTemplateData = {
    taskType: String(templateData.taskType || generation.type || "video_gen"),
    ...templateData
  };

  await prisma.generation.update({
    where: { id: generationId },
    data: {
      templateData: JSON.stringify(nextTemplateData)
    }
  });

  return NextResponse.json({ success: true });
}
