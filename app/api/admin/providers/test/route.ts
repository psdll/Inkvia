import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveDraftTarget, safeNetworkMessage, testProviderLine } from "@/lib/providers/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ error: apiErrorMessage(auth.error) }, 401);
  try {
    const target = await resolveDraftTarget(await req.json().catch(() => null) || {});
    if (!target) return json({ error: apiMessage("m3b05019002fc") }, 400);
    const result = await testProviderLine(target);
    return json({ success: result.ok, ...result, hasKey: target.provider.hasKey });
  } catch (error) {
    return json({ success: false, ok: false, status: 0, message: safeNetworkMessage(error) }, 400);
  }
}
