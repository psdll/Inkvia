import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { isMaterialCreatorInspirationEnabled } from "@/lib/material-creator-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INSPIRATION_LEN = 500;

function parseId(raw: string) {
  const id = Math.floor(Number(raw));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

// 制作人给"自己制作的素材"写创作灵感。
// 权限绑"名字"不绑账号：登录用户名 == 该素材的制作人名字（精确、去首尾空格）才能写。
// 空内容 = 删除灵感。管理员改/删走管理端 PATCH（见 admin/material-assets/[id]）。
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
    }

    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });
    }

    const asset = await prisma.materialAsset.findFirst({ where: { id, isDeleted: false } });
    if (!asset) {
      return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    }

    const creator = String(asset.creatorName || "").trim();
    if (!creator || creator !== String(currentUser.username || "").trim()) {
      return NextResponse.json({ error: apiMessage("m5ea60b455f3b") }, { status: 403 });
    }
    if (!(await isMaterialCreatorInspirationEnabled(currentUser.username))) {
      return NextResponse.json({ error: apiMessage("m9e4450ab36be") }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as { inspiration?: unknown } | null;
    const text = String(body?.inspiration ?? "").trim().slice(0, MAX_INSPIRATION_LEN);
    const inspiration = text || null;

    await prisma.materialAsset.update({ where: { id }, data: { inspiration } });

    return NextResponse.json({ success: true, item: { id, inspiration } });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m914a189b6807")) }, { status: 500 });
  }
}
