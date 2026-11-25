import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { GET as monthly } from "../monthly/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!req.nextUrl.searchParams.get("userId"))
    return NextResponse.json({ error: apiMessage("me4d7b1dca1d3") }, { status: 400 });
  if (!req.nextUrl.searchParams.get("month"))
    return NextResponse.json(
      { error: apiMessage("me27fccb8f7a1") },
      { status: 400 },
    );
  return monthly(req);
}
