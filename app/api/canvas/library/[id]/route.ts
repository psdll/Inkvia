import { apiMessage } from "@/i18n/api-message";
// 画布产物库：单条更新 / 删除。
//   PATCH  /api/canvas/library/[id]   body: { name?, folder? }   → 重命名 / 移动文件夹
//   DELETE /api/canvas/library/[id]                              → 删除条目+其媒体文件

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { deleteItem, updateItem } from "@/lib/canvas/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { name?: string; folder?: string } | null;
  if (!body) return NextResponse.json({ success: false, error: apiMessage("mcc55840ee422") }, { status: 400 });
  const item = await updateItem(authUserId, params.id, {
    name: body.name !== undefined ? String(body.name) : undefined,
    folder: body.folder !== undefined ? String(body.folder) : undefined,
  });
  if (!item) return NextResponse.json({ success: false, error: apiMessage("m17314a19ac96") }, { status: 404 });
  return NextResponse.json({ success: true, item });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  await deleteItem(authUserId, params.id);
  return NextResponse.json({ success: true });
}
