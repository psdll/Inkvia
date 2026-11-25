import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server-auth";
import { isInspirationTemplateUploadAllowed } from "@/lib/inspiration-template-upload-permission";
import {
  createInspirationTemplateFromGeneration,
  getUserInspirationTemplateForGeneration,
} from "@/lib/inspiration-template-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const generationId = Number(searchParams.get("generationId") || 0);
  if (!Number.isFinite(generationId) || generationId <= 0) {
    return NextResponse.json({ success: false, error: apiMessage("m64264a946d08") }, { status: 400 });
  }

  const ref = await getUserInspirationTemplateForGeneration(user.id, generationId);
  return NextResponse.json({
    success: true,
    data: ref ? { templateId: ref.templateId, sourceGenerationId: ref.sourceGenerationId } : null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  if (!(await isInspirationTemplateUploadAllowed(user.username))) {
    return NextResponse.json({ success: false, error: apiMessage("m91ea43586c2e") }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { generationId?: number } | null;
  const result = await createInspirationTemplateFromGeneration(Number(body?.generationId || 0), {
    kind: "user",
    userId: user.id,
    username: user.username,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: apiErrorMessage(result.error) }, { status: result.status });
  }
  return NextResponse.json({ success: true, alreadyExists: result.alreadyExists, data: result.data });
}
