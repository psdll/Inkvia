import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server-auth";
import { isInspirationTemplateUploadAllowed } from "@/lib/inspiration-template-upload-permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ success: true, allowed: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const allowed = await isInspirationTemplateUploadAllowed(user.username);
  return NextResponse.json(
    { success: true, allowed },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
