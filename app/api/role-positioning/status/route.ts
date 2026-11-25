import { NextResponse } from "next/server";
import { getRolePositioningVisible } from "@/lib/role-positioning-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

export async function GET() {
  try {
    const enabled = await getRolePositioningVisible();
    return NextResponse.json({ enabled }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { enabled: false },
      { headers: NO_STORE_HEADERS },
    );
  }
}
