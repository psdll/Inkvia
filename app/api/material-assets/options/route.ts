import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  isMaterialAssetOptionKind,
  listMaterialAssetOptionValues,
  markMaterialAssetOptionDeleted,
  normalizeMaterialAssetOptionValue,
} from "@/lib/material-asset-options";
import { isMaterialUploadAllowed } from "@/lib/material-upload-permission";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function canManageMaterialAssetOptions(request: NextRequest) {
  if (requireAdminRequest(request).ok) return true;
  const user = await getCurrentUser(request);
  return Boolean(user && await isMaterialUploadAllowed(user.username));
}

export async function GET(request: NextRequest) {
  try {
    if (!(await canManageMaterialAssetOptions(request))) {
      return NextResponse.json({ error: apiMessage("m3b14e5dba56e") }, { status: 403 });
    }
    const values = await listMaterialAssetOptionValues();
    return NextResponse.json({ success: true, categories: values.category, creators: values.creator, models: values.model });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m97830a2bc193")) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!(await canManageMaterialAssetOptions(request))) {
      return NextResponse.json({ error: apiMessage("m3b14e5dba56e") }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { kind?: unknown; value?: unknown };
    if (!isMaterialAssetOptionKind(body.kind)) return NextResponse.json({ error: apiMessage("mbeceea07e8b8") }, { status: 400 });
    const value = normalizeMaterialAssetOptionValue(body.kind, body.value);
    if (!value) return NextResponse.json({ error: apiMessage("m8638cebe9bd1") }, { status: 400 });

    await markMaterialAssetOptionDeleted(prisma, body.kind, value);
    return NextResponse.json({ success: true, kind: body.kind, value });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m86288d8c9fa0")) }, { status: 500 });
  }
}
