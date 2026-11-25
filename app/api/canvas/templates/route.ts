import { apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: apiMessage("mac5494aba066"),
    },
    { status: 410 },
  );
}
