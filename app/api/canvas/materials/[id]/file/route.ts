import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { readPersonalMaterialResponse } from "@/lib/canvas/personal-material-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserId(req); if (!user) return new NextResponse(null, { status: 401 });
  return readPersonalMaterialResponse(req, user, params.id);
}
