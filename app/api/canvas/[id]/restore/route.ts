import { apiMessage } from "@/i18n/api-message";
// 无限画布：从回收站恢复（清除 deletedAt）。
//   POST /api/canvas/[id]/restore

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });

  const restored = await prisma.canvas.updateMany({
    where: { id, authUserId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (restored.count === 0) {
    return NextResponse.json({ success: false, error: apiMessage("mee3ad5b8c26e") }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
