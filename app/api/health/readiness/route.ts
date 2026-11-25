import { NextResponse } from "next/server";
import { runReadinessChecks } from "@/lib/runtime-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await runReadinessChecks();
  return NextResponse.json(report, {
    status: report.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
