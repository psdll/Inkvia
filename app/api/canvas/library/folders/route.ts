import { apiMessage } from "@/i18n/api-message";
// 画布产物库：文件夹增删改。
//   GET    /api/canvas/library/folders                         → 文件夹列表
//   POST   /api/canvas/library/folders   body: { name }        → 新增
//   PATCH  /api/canvas/library/folders   body: { from, to }    → 重命名（含迁移条目）
//   DELETE /api/canvas/library/folders   body: { name }        → 删除（条目移回 default）

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { addFolder, deleteFolder, listFolders, renameFolder } from "@/lib/canvas/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  return NextResponse.json({ success: true, folders: await listFolders(authUserId) });
}

export async function POST(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ success: false, error: apiMessage("m03a4f5c8b8b4") }, { status: 400 });
  return NextResponse.json({ success: true, folders: await addFolder(authUserId, name) });
}

export async function PATCH(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { from?: string; to?: string } | null;
  const from = String(body?.from ?? "").trim();
  const to = String(body?.to ?? "").trim();
  if (!from || !to) return NextResponse.json({ success: false, error: apiMessage("mf235499ed438") }, { status: 400 });
  return NextResponse.json({ success: true, folders: await renameFolder(authUserId, from, to) });
}

export async function DELETE(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ success: false, error: apiMessage("m03a4f5c8b8b4") }, { status: 400 });
  return NextResponse.json({ success: true, folders: await deleteFolder(authUserId, name) });
}
