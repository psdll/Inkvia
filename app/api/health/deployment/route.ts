import { NextResponse } from "next/server";
import { runDeploymentHealth } from "@/lib/deployment-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { ok, body } = await runDeploymentHealth();
  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
