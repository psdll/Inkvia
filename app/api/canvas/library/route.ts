import { apiMessage } from "@/i18n/api-message";
// 工作流列表；旧媒体 POST 停用，个人素材使用 /api/canvas/materials。
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { listItems } from "@/lib/canvas/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const folder = req.nextUrl.searchParams.get("folder") || undefined;
  const items = await listItems(authUserId, folder || undefined);
  return NextResponse.json({ success: true, items });
}

export async function POST(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  return NextResponse.json({ success: false, error: apiMessage("mb3936dbe65ba") }, { status: 410 });
}
