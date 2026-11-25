import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
// 画布临时上传孤儿清理（按当前用户）。
//   POST /api/canvas/cleanup → { removed }
//
// 由画布页进入时 fire-and-forget 触发；24h 宽限期，只删未被任何画布引用的临时图。

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { cleanupOrphanCanvasUploads } from "@/lib/canvas/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  try {
    const removed = await cleanupOrphanCanvasUploads(authUserId);
    return NextResponse.json({ success: true, removed });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(String(e?.message || "清理失败")) }, { status: 500 });
  }
}
