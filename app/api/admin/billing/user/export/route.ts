import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { GET as monthly } from "../../monthly/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (
    !req.nextUrl.searchParams.get("userId") ||
    !req.nextUrl.searchParams.get("month")
  )
    return NextResponse.json(
      { error: apiMessage("m811b8849dc6f") },
      { status: 400 },
    );
  const url = req.nextUrl.clone();
  url.searchParams.set("export", "details");
  return monthly(new NextRequest(url, { headers: req.headers }));
}
