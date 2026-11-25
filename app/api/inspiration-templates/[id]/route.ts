import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server-auth";
import { deleteInspirationTemplate } from "@/lib/inspiration-template-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  try {
    const result = await deleteInspirationTemplate(Number(params.id), {
      kind: "user",
      userId: user.id,
      username: user.username,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: apiErrorMessage(result.error) }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(String(e?.message || "删除失败")) }, { status: 500 });
  }
}
