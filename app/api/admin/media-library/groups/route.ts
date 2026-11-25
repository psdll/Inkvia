import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { normalizeMediaLibraryGroupName } from "@/lib/media-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const auth = requireAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ error: apiMessage("m4f3e3a6051ab") }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as { oldGroupName?: string; newGroupName?: string } | null;
    const oldGroupName = normalizeMediaLibraryGroupName(body?.oldGroupName);
    const newGroupName = normalizeMediaLibraryGroupName(body?.newGroupName);

    if (!oldGroupName) {
      return NextResponse.json({ error: apiMessage("m248363654c1b") }, { status: 400 });
    }
    if (!newGroupName) {
      return NextResponse.json({ error: apiMessage("mb7edd541489c") }, { status: 400 });
    }
    if (oldGroupName === newGroupName) {
      return NextResponse.json({ success: true, count: 0 });
    }

    // updatedAt 由 Prisma @updatedAt 自动维护
    const result = await prisma.mediaLibraryItem.updateMany({
      where: { isDeleted: false, groupName: oldGroupName },
      data: { groupName: newGroupName },
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m47095c71c050")) }, { status: 500 });
  }
}
