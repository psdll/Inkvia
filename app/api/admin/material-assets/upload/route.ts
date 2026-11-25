import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { getCurrentUser } from "@/lib/server-auth";
import {
  MaterialAssetUploadError,
  uploadMaterialAssetsFromForm,
} from "@/lib/material-asset-upload-service";
import {
  UploadLimitError,
  assertRequestContentLengthUnderLimit,
  assertUploadDiskWatermark,
} from "@/lib/upload-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }

    const currentUser = await getCurrentUser(request);
    assertRequestContentLengthUnderLimit(request);
    const form = await request.formData();
    const files = [...form.getAll("files"), form.get("file")].filter((entry): entry is File => entry instanceof File && entry.size > 0);
    await assertUploadDiskWatermark(files, { label: "Admin material upload" });
    const result = await uploadMaterialAssetsFromForm(form, {
      createdByUserId: currentUser?.id ?? null,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof UploadLimitError) {
      return NextResponse.json({ error: apiErrorMessage(error.message) }, { status: error.status });
    }
    if (error instanceof MaterialAssetUploadError) {
      return NextResponse.json({ error: apiErrorMessage(error.message) }, { status: error.status });
    }
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mc6f52e351556")) }, { status: 500 });
  }
}
