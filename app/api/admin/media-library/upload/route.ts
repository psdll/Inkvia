import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { requireAdminRequest } from "@/lib/admin-auth";
import { buildMediaLibraryTitle, inferMediaLibraryKind, normalizeMediaLibraryGroupName, parseMediaLibraryTags, stringifyMediaLibraryTags } from "@/lib/media-library";
import { saveBufferFile } from "@/lib/storage";
import { validateUploadFile } from "@/lib/upload-validation";
import { createMediaLibraryImagePreview, createMediaLibraryVideoPoster } from "@/lib/media-library-thumbnails";
import { PRODUCT_LIBRARY_POSTERS_FOLDER, PRODUCT_LIBRARY_PREVIEWS_FOLDER, productLibrarySharedFolder } from "@/lib/upload-buckets";
import {
  UploadLimitError,
  assertRequestContentLengthUnderLimit,
  assertUploadBatchWithinLimits,
  assertUploadDiskWatermark,
} from "@/lib/upload-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFileName(name: string) {
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 60) || "product";
  return `product_${Date.now()}_${base}${ext}`;
}

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }

    const currentUser = await getCurrentUser(request);

    assertRequestContentLengthUnderLimit(request);
    const form = await request.formData();
    const tags = parseMediaLibraryTags(form.get("tags"));
    const groupName = normalizeMediaLibraryGroupName(form.get("groupName"));
    const formFiles = [
      ...form.getAll("files"),
      form.get("file"),
    ].filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (!formFiles.length) {
      return NextResponse.json({ error: apiMessage("m48835551e6fb") }, { status: 400 });
    }
    assertUploadBatchWithinLimits(formFiles, { label: "Shared media library upload" });
    await assertUploadDiskWatermark(formFiles, { label: "Shared media library upload" });

    for (const file of formFiles) {
      const validation = await validateUploadFile(file);
      if (!validation.ok) {
        return NextResponse.json(
          { error: apiErrorMessage(`${file.name}: ${validation.error || "文件校验失败"}`) },
          { status: 400 },
        );
      }
    }

    const items = [];
    for (const file of formFiles) {
      const kind = inferMediaLibraryKind({ type: file.type, name: file.name });
      const folder = productLibrarySharedFolder(kind);
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const localUrl = await saveBufferFile(fileBuffer, folder, {
        fileName: safeFileName(file.name),
        contentType: file.type || undefined,
        fallbackExt: kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png",
      });
      const displayUrl =
        kind === "image"
          ? (await createMediaLibraryImagePreview(fileBuffer, {
              contentType: file.type || undefined,
              folder: PRODUCT_LIBRARY_PREVIEWS_FOLDER,
              kind,
              sourceName: file.name,
            })) || localUrl
          : kind === "video"
            ? (await createMediaLibraryVideoPoster(fileBuffer, {
                contentType: file.type || undefined,
                folder: PRODUCT_LIBRARY_POSTERS_FOLDER,
                kind,
                sourceName: file.name,
              })) || localUrl
            : localUrl;
      const nextTitle = buildMediaLibraryTitle(form.get("title"), file.name);
      const created = await prisma.mediaLibraryItem.create({
        data: {
          scope: "shared",
          kind,
          groupName,
          title: nextTitle,
          fileUrl: localUrl,
          thumbnailUrl: displayUrl,
          mimeType: file.type || null,
          sizeBytes: Number(file.size) || 0,
          tags: stringifyMediaLibraryTags(tags),
          sortOrder: 0,
          ownerUserId: null,
          createdByUserId: currentUser?.id ?? null,
          isDeleted: false,
        },
      });
      items.push({
        id: created.id,
        scope: "shared",
        kind,
        groupName,
        title: nextTitle,
        fileUrl: localUrl,
        thumbnailUrl: displayUrl,
        mimeType: file.type || null,
        sizeBytes: Number(file.size) || 0,
        tags,
        createdAt: created.createdAt.toISOString(),
        canDelete: true,
      });
    }

    return NextResponse.json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error: any) {
    if (error instanceof UploadLimitError) {
      return NextResponse.json({ error: apiErrorMessage(error.message) }, { status: error.status });
    }
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mff0c2edf5c56")) }, { status: 500 });
  }
}
