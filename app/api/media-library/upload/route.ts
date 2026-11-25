import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { buildMediaLibraryTitle, inferMediaLibraryKind, normalizeMediaLibraryGroupName, normalizeMediaLibraryScope, parseMediaLibraryTags, stringifyMediaLibraryTags } from "@/lib/media-library";
import { saveBufferFile } from "@/lib/storage";
import { getProductFolders, withProductFolders } from "@/lib/media-library-folders-server";
import { folderDestination } from "@/lib/media-library-folders";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { validateUploadFile } from "@/lib/upload-validation";
import { createMediaLibraryImagePreview, createMediaLibraryVideoPoster } from "@/lib/media-library-thumbnails";
import { PRODUCT_LIBRARY_POSTERS_FOLDER, PRODUCT_LIBRARY_PREVIEWS_FOLDER, mediaLibraryPrivateFolderForSource } from "@/lib/upload-buckets";
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

function safeUserFolderName(name: string) {
  const raw = String(name || "").trim();
  const normalized = raw.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return normalized || "unknown_user";
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
    }

    assertRequestContentLengthUnderLimit(request);
    const form = await request.formData();
    const scope = normalizeMediaLibraryScope(form.get("scope"));
    const title = buildMediaLibraryTitle(form.get("title"), String((form.get("file") as File | null)?.name || ""));
    const tags = parseMediaLibraryTags(form.get("tags"));
    let groupName = normalizeMediaLibraryGroupName(form.get("groupName"));
    const folderId = form.get("folderId");
    const uploadSource = form.get("uploadSource") === "agent" ? "agent" : "library";
    const file = form.get("file");

    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: apiMessage("m48835551e6fb") }, { status: 400 });
    }
    assertUploadBatchWithinLimits([file], { label: "Media library upload" });
    await assertUploadDiskWatermark([file], { label: "Media library upload" });

    const validation = await validateUploadFile(file);
    if (!validation.ok) {
      return NextResponse.json({ error: apiErrorMessage(validation.error || apiMessage("m076673fd9b38")) }, { status: 400 });
    }

    if (scope === "shared") {
      return NextResponse.json({ error: apiMessage("m0fadb8981a10") }, { status: 403 });
    }

    // Older clients keep their original upload contract during rolling upgrades.
    if (folderId !== null) groupName = folderDestination(await getProductFolders(currentUser.id), folderId);

    const kind = inferMediaLibraryKind({ type: file.type, name: file.name });
    const usernameFolder = safeUserFolderName(currentUser.username);
    const folder = mediaLibraryPrivateFolderForSource(uploadSource, usernameFolder, kind);

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
    const data = {
        scope,
        kind,
        groupName,
        title,
        fileUrl: localUrl,
        thumbnailUrl: displayUrl,
        mimeType: file.type || null,
        sizeBytes: Number(file.size) || 0,
        tags: stringifyMediaLibraryTags(tags),
        sortOrder: 0,
        ownerUserId: scope === "private" ? currentUser.id : null,
        createdByUserId: currentUser.id,
        isDeleted: false,
      };
    const created = await (folderId !== null
      ? withProductFolders(currentUser.id, async (tx, folders) => {
          const destination = folderDestination(folders, folderId);
          return tx.mediaLibraryItem.create({ data: { ...data, groupName: destination } });
        })
      : prisma.mediaLibraryItem.create({ data })).catch(async error => {
        // A folder may be removed while bytes/previews are being written.
        // Remove only this failed upload; the cleanup service checks references.
        await deleteStoredMediaRefs([localUrl, displayUrl], { allowMaterialDeletion: true }).catch(() => undefined);
        throw error;
      });
    const item = {
      id: created.id,
      scope,
      kind,
      groupName,
      title,
      fileUrl: localUrl,
      thumbnailUrl: displayUrl,
      mimeType: file.type || null,
      sizeBytes: Number(file.size) || 0,
      tags,
      createdAt: created.createdAt.toISOString(),
      ownerUserId: scope === "private" ? currentUser.id : null,
    };

    return NextResponse.json({
      success: true,
      item: {
        ...item,
        scope,
        kind,
        tags,
        canDelete: scope === "private" ? item.ownerUserId === currentUser.id : true,
      },
    });
  } catch (error: any) {
    if (error instanceof UploadLimitError) {
      return NextResponse.json({ error: apiErrorMessage(error.message) }, { status: error.status });
    }
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mc6f52e351556")) }, { status: 500 });
  }
}
