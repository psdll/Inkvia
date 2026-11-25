import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { createInspirationTemplateFromGeneration } from "@/lib/inspiration-template-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { generationId?: number } | null;
  const result = await createInspirationTemplateFromGeneration(Number(body?.generationId || 0), {
    kind: "admin",
    username: auth.username,
  });

  if (!result.ok) {
    return NextResponse.json({ success: false, error: apiErrorMessage(result.error) }, { status: result.status });
  }
  return NextResponse.json({ success: true, data: result.data });
}
