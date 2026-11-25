import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
// 轻量「占用状态」接口。
//
// 用法:  GET /api/material-assets/selection-state?ids=1,2,3
//
// 设计目的:
//   素材库只同步当前渲染窗口和详情中的占用状态，每次最多 200 条。
//   同一进程内相同 ID 集合的并发查询共用一次读库，完成后立即释放，不缓存旧状态。
//   用户相关的「我已挑选」仍在每个请求内单独计算。
//
// 注意: 这只是「显示层」的及时性优化。真正防止两人抢同一素材的,是 /[id]/select 里的
//       原子条件更新 updateMany(where selectedByUserId: null) —— 那才是最终防线。

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 200;
const selectionReads = new Map<string, ReturnType<typeof readSelectionRows>>();

async function readSelectionRows(ids: number[]) {
  return prisma.materialAsset.findMany({
    where: { id: { in: ids }, isDeleted: false },
    select: {
      id: true,
      selectedByUserId: true,
      selectedAt: true,
      selectedMediaId: true,
      selectedByUser: { select: { id: true, username: true } },
      _count: { select: { downloads: true } },
    },
  });
}

async function readSharedSelectionRows(ids: number[]) {
  const key = [...ids].sort((a, b) => a - b).join(",");
  let pending = selectionReads.get(key);
  if (!pending) {
    pending = readSelectionRows(ids);
    selectionReads.set(key, pending);
  }
  try { return await pending; } finally {
    if (selectionReads.get(key) === pending) selectionReads.delete(key);
  }
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    const { searchParams } = new URL(request.url);
    const idsRaw = String(searchParams.get("ids") || "").trim();
    if (!idsRaw) return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });

    const ids = Array.from(
      new Set(
        idsRaw
          .split(",")
          .map((s) => Math.floor(Number(s)))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    ).slice(0, MAX_IDS);
    if (!ids.length) return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });

    const rows = await readSharedSelectionRows(ids);

    const items = rows.map((row) => ({
      id: row.id,
      isSelected: Boolean(row.selectedByUserId),
      isSelectedByMe: row.selectedByUserId === (currentUser?.id ?? null),
      selectedBy: row.selectedByUser
        ? {
            id: row.selectedByUser.id,
            username: row.selectedByUser.username,
            selectedAt: row.selectedAt?.toISOString() || null,
            selectedMediaId: row.selectedMediaId || null,
          }
        : null,
      selectedMediaId: row.selectedMediaId || null,
      downloadCount: row._count?.downloads || 0,
    }));

    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mf06712c2cbe8")) }, { status: 500 });
  }
}
