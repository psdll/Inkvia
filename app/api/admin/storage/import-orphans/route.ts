import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { deleteImportOrphanCandidates, scanImportOrphanCandidates } from "@/lib/admin-import-orphans";

function bad(error: string, status = 400) {
  return NextResponse.json({ success: false, error: apiErrorMessage(error) }, { status });
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  try {
    const result = await scanImportOrphanCandidates();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "扫描 imports 未引用素材失败", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  try {
    const result = await deleteImportOrphanCandidates();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "删除 imports 未引用素材失败", 500);
  }
}
