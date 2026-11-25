import { apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: apiMessage("m5f1e1089d2ac") },
    { status: 410 },
  );
}
