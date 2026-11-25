import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { deleteInspirationTemplate } from "@/lib/inspiration-template-service";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  try {
    const result = await deleteInspirationTemplate(Number(params.id), {
      kind: "admin",
      username: auth.username,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: apiErrorMessage(result.error) }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(String(e?.message || "删除失败")) }, { status: 500 });
  }
}
