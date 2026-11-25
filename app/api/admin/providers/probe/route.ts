import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: apiErrorMessage(auth.error) },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      success: false,
      ok: false,
      error: apiMessage("mfa847016ce22"),
      status: "probe-retired",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
