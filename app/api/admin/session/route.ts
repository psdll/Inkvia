import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  const authenticated = isAdminRequest(request);
  return NextResponse.json(
    { authenticated },
    { status: authenticated ? 200 : 401, headers: NO_STORE },
  );
}
