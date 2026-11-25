import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server-auth";
import { isMaterialUploadAllowed } from "@/lib/material-upload-permission";
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
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
    }
    if (!(await isMaterialUploadAllowed(user.username))) {
      return NextResponse.json({ error: apiMessage("m2c62231bef9e") }, { status: 403 });
    }

    assertRequestContentLengthUnderLimit(request);
    const form = await request.formData();
    const files = [...form.getAll("files"), form.get("file")].filter((entry): entry is File => entry instanceof File && entry.size > 0);
    await assertUploadDiskWatermark(files, { label: "Material upload" });
    const result = await uploadMaterialAssetsFromForm(form, {
      createdByUserId: user.id,
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
