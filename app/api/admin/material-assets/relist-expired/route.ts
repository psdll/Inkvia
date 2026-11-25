import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = requireAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: apiErrorMessage(auth.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
  // Older clients must not reorder the entire library after the age policy is removed.
  return NextResponse.json({ success: false, code: "MATERIAL_ARCHIVE_RETIRED", error: apiMessage("mbcfa625cde21") }, { status: 410 });
}
