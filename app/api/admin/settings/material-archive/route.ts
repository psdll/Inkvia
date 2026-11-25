import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Keep an explicit response for administrator tabs left open during an upgrade.
export async function GET(request: NextRequest) {
  const auth = requireAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });
  return NextResponse.json({ success: false, code: "MATERIAL_ARCHIVE_RETIRED", error: apiMessage("m6ef94d22fdb1") }, { status: 410 });
}

export const POST = GET;
