import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  getRolePositioningVisible,
  saveRolePositioningVisible,
} from "@/lib/role-positioning-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: apiErrorMessage(auth.error) },
      { status: 401 },
    );
  }

  const enabled = await getRolePositioningVisible();
  return NextResponse.json({ success: true, enabled });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: apiErrorMessage(auth.error) },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    enabled?: unknown;
  } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { success: false, error: apiMessage("mb2925e4acc75") },
      { status: 400 },
    );
  }

  await saveRolePositioningVisible(body.enabled);
  return NextResponse.json({ success: true, enabled: body.enabled });
}
