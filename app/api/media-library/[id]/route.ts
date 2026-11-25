import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { requireAdminRequest } from "@/lib/admin-auth";
import { normalizeMediaLibraryGroupName } from "@/lib/media-library";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { isAgentImportMediaRef } from "@/lib/upload-buckets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const agentImportOnly = request.nextUrl.searchParams.get("agentImportOnly") === "1";
    const id = Math.floor(Number(params.id));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });
    }

    const item = await prisma.mediaLibraryItem.findUnique({ where: { id } });
    if (!item || item.isDeleted) {
      return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    }

    if (agentImportOnly) {
      const currentUser = await getCurrentUser(request);
      if (!currentUser) {
        return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
      }
      if (item.scope !== "private" || item.ownerUserId !== currentUser.id || !isAgentImportMediaRef(item.fileUrl)) {
        return NextResponse.json({ success: true, deleted: false });
      }
    } else if (item.scope === "private") {
      const currentUser = await getCurrentUser(request);
      if (!currentUser) {
        return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
      }
      if (item.ownerUserId !== currentUser.id) {
        return NextResponse.json({ error: apiMessage("m6078e6145662") }, { status: 403 });
      }
    } else {
      const auth = requireAdminRequest(request);
      if (!auth.ok) {
        return NextResponse.json({ error: apiMessage("mfa6eb5ac103f") }, { status: 403 });
      }
    }

    if (agentImportOnly) {
      await prisma.mediaLibraryItem.delete({ where: { id } });
    } else {
      await prisma.mediaLibraryItem.update({
        where: { id },
        data: { isDeleted: true },
      });
    }
    const deleted = await deleteStoredMediaRefs([item.fileUrl, item.thumbnailUrl], {
      allowMaterialDeletion: true,
      excludeMediaLibraryItemIds: [id],
    });

    return NextResponse.json({
      success: true,
      deleted: true,
      deletedLocalFiles: deleted.deletedLocalFiles,
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mb4adde6a7547")) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Math.floor(Number(params.id));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });
    }

    const item = await prisma.mediaLibraryItem.findUnique({ where: { id } });
    if (!item || item.isDeleted) {
      return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    }

    if (item.scope === "private") {
      const currentUser = await getCurrentUser(request);
      if (!currentUser) {
        return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
      }
      if (item.ownerUserId !== currentUser.id) {
        return NextResponse.json({ error: apiMessage("m644585b984c7") }, { status: 403 });
      }
    } else {
      const auth = requireAdminRequest(request);
      if (!auth.ok) {
        return NextResponse.json({ error: apiMessage("m39cb7155bfe7") }, { status: 403 });
      }
    }

    const body = (await request.json().catch(() => null)) as { groupName?: string | null } | null;
    const groupName = normalizeMediaLibraryGroupName(body?.groupName);

    await prisma.mediaLibraryItem.update({
      where: { id },
      data: { groupName },
    });

    return NextResponse.json({ success: true, item: { id, groupName } });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m17c31777f112")) }, { status: 500 });
  }
}
