import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { runDeploymentHealth } from "@/lib/deployment-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, errorCode: "UNAUTHENTICATED" },
      { status: 401, headers: NO_STORE },
    );
  }

  const health = await runDeploymentHealth().catch(() => null);

  return NextResponse.json(
    {
      success: true,
      current: {
        version: health?.body.version ?? null,
        commit: health?.body.commit ?? null,
      },
    },
    { headers: NO_STORE },
  );
}
