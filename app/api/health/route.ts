import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const details = {
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    liveness: "/api/health/liveness",
    readiness: "/api/health/readiness",
  };
  try {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    if (rows[0]?.ok !== 1) throw new Error("Database health check failed");
    return NextResponse.json(
      { status: "ok", checks: { database: "ok" }, ...details },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "error", checks: { database: "error" }, ...details },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
