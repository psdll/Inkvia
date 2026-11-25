import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";
import {
  normalizeMaterialAssetCategory,
  parseMaterialAssetTags,
  parseStoredMaterialAssetTags,
  stringifyMaterialAssetTags,
} from "@/lib/material-assets";
import {
  normalizeMaterialAssetOptionValue,
  upsertMaterialAssetOptions,
} from "@/lib/material-asset-options";
import {
  createMaterialAssetMediaId,
  findMaterialAssetMedia,
  materialAssetAllMediaRefs,
  materialAssetCoverPatch,
  materialAssetMediaRefs,
  MAX_MATERIAL_ASSET_GROUP_MEDIA,
  normalizeMaterialAssetMediaItem,
  parseMaterialAssetMedia,
  type MaterialAssetMediaItem,
} from "@/lib/material-asset-media";
import {
  createMediaLibraryImagePreview,
  createMediaLibraryImageThumbnail,
} from "@/lib/media-library-thumbnails";
import { saveBufferFile } from "@/lib/storage";
import { validateUploadFile } from "@/lib/upload-validation";
import {
  MATERIAL_ASSET_ORIGINALS_FOLDER,
  MATERIAL_ASSET_PREVIEWS_FOLDER,
  MATERIAL_ASSET_THUMBNAILS_FOLDER,
} from "@/lib/upload-buckets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string) {
  const id = Math.floor(Number(raw));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function safeFileName(name: string) {
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 60) || "material";
  return `material_${Date.now()}_${base}${ext}`;
}

async function fileToStoredMedia(file: File, id?: string): Promise<MaterialAssetMediaItem> {
  const validation = await validateUploadFile(file, ["image"], { image: 30 * 1024 * 1024 });
  if (!validation.ok) {
    throw new Error(`${file.name}：${validation.error || "文件校验失败"}`);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const imageUrl = await saveBufferFile(buffer, MATERIAL_ASSET_ORIGINALS_FOLDER, {
    fileName: safeFileName(file.name),
    contentType: file.type || undefined,
    fallbackExt: "png",
  });
  const thumbnailUrl =
    (await createMediaLibraryImageThumbnail(buffer, {
      contentType: file.type || undefined,
      folder: MATERIAL_ASSET_THUMBNAILS_FOLDER,
      kind: "image",
      sourceName: file.name,
    })) || imageUrl;
  const previewUrl =
    (await createMediaLibraryImagePreview(buffer, {
      contentType: file.type || undefined,
      folder: MATERIAL_ASSET_PREVIEWS_FOLDER,
      kind: "image",
      sourceName: file.name,
    })) || imageUrl;
  return {
    id: id || createMaterialAssetMediaId(),
    originalUrl: imageUrl,
    thumbnailUrl,
    previewUrl,
    mime: file.type || null,
    size: Number(file.size) || buffer.length || null,
  };
}

function serializeAsset(asset: any) {
  const mediaItems = parseMaterialAssetMedia(asset.media, asset);
  return {
    id: asset.id,
    category: normalizeMaterialAssetCategory(asset.category),
    title: asset.title,
    imageUrl: asset.imageUrl,
    thumbnailUrl: asset.thumbnailUrl || null,
    previewUrl: asset.previewUrl || null,
    mimeType: asset.mimeType || null,
    sizeBytes: asset.sizeBytes || 0,
    mediaCount: Math.max(1, Number(asset.mediaCount || mediaItems.length || 1)),
    selectedMediaId: asset.selectedMediaId || null,
    mediaItems,
    tags: parseStoredMaterialAssetTags(asset.tags),
    creatorName: asset.creatorName || null,
    modelName: asset.modelName || null,
    inspiration: asset.inspiration || null,
    createdAt: asset.createdAt.toISOString(),
    selectedBy: asset.selectedByUser
      ? {
          id: asset.selectedByUser.id,
          username: asset.selectedByUser.username,
          selectedAt: asset.selectedAt?.toISOString() || null,
          selectedMediaId: asset.selectedMediaId || null,
        }
      : null,
    isSelected: Boolean(asset.selectedByUserId),
  };
}

async function parsePatchRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const rawMedia = String(form.get("media") || "").trim();
    const media = rawMedia ? JSON.parse(rawMedia) : undefined;
    const files = new Map<string, File>();
    for (const [key, value] of form.entries()) {
      if (value instanceof File && value.size > 0) files.set(key, value);
    }
    return {
      title: form.has("title") ? String(form.get("title") || "") : undefined,
      category: form.has("category") ? form.get("category") : undefined,
      tags: form.has("tags") ? form.get("tags") : undefined,
      modelName: form.has("modelName") ? form.get("modelName") : undefined,
      inspiration: form.has("inspiration") ? String(form.get("inspiration") || "") : undefined,
      media,
      files,
    };
  }
  const json = (await request.json().catch(() => null)) as any;
  return {
    title: json && Object.prototype.hasOwnProperty.call(json, "title") ? json.title : undefined,
    category: json && Object.prototype.hasOwnProperty.call(json, "category") ? json.category : undefined,
    tags: json && Object.prototype.hasOwnProperty.call(json, "tags") ? json.tags : undefined,
    modelName: json && Object.prototype.hasOwnProperty.call(json, "modelName") ? json.modelName : undefined,
    inspiration: json && Object.prototype.hasOwnProperty.call(json, "inspiration") ? json.inspiration : undefined,
    media: json?.media,
    files: new Map<string, File>(),
  };
}

async function buildPatchMedia(rawMedia: unknown, files: Map<string, File>) {
  if (!Array.isArray(rawMedia)) return null;
  if (rawMedia.length < 1) throw new Error("素材至少需要 1 张图片");
  if (rawMedia.length > MAX_MATERIAL_ASSET_GROUP_MEDIA) throw new Error(`单个系列图最多 ${MAX_MATERIAL_ASSET_GROUP_MEDIA} 张`);

  const next: MaterialAssetMediaItem[] = [];
  for (const raw of rawMedia) {
    const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const id = String(obj.id || "").trim() || createMaterialAssetMediaId();
    const fileKey = String(obj.fileKey || "").trim();
    const file = fileKey ? files.get(fileKey) : null;
    if (file) {
      next.push(await fileToStoredMedia(file, id));
      continue;
    }
    const normalized = normalizeMaterialAssetMediaItem({ ...obj, id });
    if (!normalized) throw new Error("系列图数据不完整");
    next.push(normalized);
  }
  return next;
}

function changedOrRemovedRefs(oldItems: MaterialAssetMediaItem[], nextItems: MaterialAssetMediaItem[]) {
  const nextById = new Map(nextItems.map((item) => [item.id, item]));
  const refs: string[] = [];
  for (const oldItem of oldItems) {
    const nextItem = nextById.get(oldItem.id);
    if (!nextItem || nextItem.originalUrl !== oldItem.originalUrl || nextItem.thumbnailUrl !== oldItem.thumbnailUrl || nextItem.previewUrl !== oldItem.previewUrl) {
      refs.push(...materialAssetMediaRefs([oldItem]));
    }
  }
  return refs;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }
    const id = parseId(params.id);
    if (!id) return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });
    const asset = await prisma.materialAsset.findFirst({
      where: { id, isDeleted: false },
      include: { selectedByUser: { select: { id: true, username: true } } },
    });
    if (!asset) return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    return NextResponse.json({ success: true, item: serializeAsset(asset) });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m088497595c7d")) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let cleanupRefs: string[] = [];
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }
    const id = parseId(params.id);
    if (!id) return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });

    const body = await parsePatchRequest(request);
    const nextMedia = await buildPatchMedia(body.media, body.files);
    const data: any = {};
    if (body.category !== undefined) data.category = normalizeMaterialAssetCategory(body.category);
    if (body.title !== undefined) {
      const title = String(body.title || "").trim();
      if (title) data.title = title.slice(0, 120);
    }
    if (body.tags !== undefined) data.tags = stringifyMaterialAssetTags(parseMaterialAssetTags(body.tags));
    if (body.modelName !== undefined) data.modelName = normalizeMaterialAssetOptionValue("model", body.modelName);
    // 管理员可改/删任意素材的创作灵感（清空 = 删除）
    if (body.inspiration !== undefined) {
      const text = String(body.inspiration || "").trim().slice(0, 2000);
      data.inspiration = text || null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const asset = await tx.materialAsset.findFirst({
        where: { id, isDeleted: false },
        include: { selectedByUser: { select: { id: true, username: true } } },
      });
      if (!asset) throw new Error("素材不存在");

      if (data.modelName) {
        await upsertMaterialAssetOptions(tx, { modelName: data.modelName });
      }

      if (nextMedia) {
        const oldItems = parseMaterialAssetMedia(asset.media, asset);
        if (asset.selectedByUserId && asset.selectedMediaId) {
          const oldSelected = findMaterialAssetMedia(oldItems, asset.selectedMediaId);
          const nextSelected = findMaterialAssetMedia(nextMedia, asset.selectedMediaId);
          if (!oldSelected || !nextSelected || oldSelected.originalUrl !== nextSelected.originalUrl) {
            const err: any = new Error("已被挑选的图片不能删除或替换，请先重新上架释放占用");
            err.status = 409;
            throw err;
          }
        }
        cleanupRefs = changedOrRemovedRefs(oldItems, nextMedia);
        Object.assign(data, materialAssetCoverPatch(nextMedia));
      }

      if (!Object.keys(data).length) {
        const err: any = new Error("没有可更新的内容");
        err.status = 400;
        throw err;
      }

      return tx.materialAsset.update({
        where: { id },
        data,
        include: { selectedByUser: { select: { id: true, username: true } } },
      });
    });

    if (cleanupRefs.length) {
      deleteStoredMediaRefs(cleanupRefs, {
        allowMaterialDeletion: true,
        excludeMaterialAssetIds: [id],
      }).catch((error) => console.error("[material-assets] cleanup removed media failed", error));
    }

    return NextResponse.json({ success: true, item: serializeAsset(updated) });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mf5045550585f")) }, { status: Number(error?.status || 500) });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }
    const id = parseId(params.id);
    if (!id) return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });

    const asset = await prisma.materialAsset.findUnique({ where: { id } });
    if (!asset || asset.isDeleted) {
      return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    }

    await prisma.materialAsset.update({
      where: { id },
      data: {
        isDeleted: true,
        selectedByUserId: null,
        selectedAt: null,
        selectedMediaId: null,
      },
      select: { id: true },
    });
    const deleted = await deleteStoredMediaRefs(materialAssetAllMediaRefs(asset), {
      allowMaterialDeletion: true,
      excludeMaterialAssetIds: [id],
    });

    return NextResponse.json({
      success: true,
      deletedLocalFiles: deleted.deletedLocalFiles,
      deletedOssObjects: deleted.deletedOssObjects,
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mb4adde6a7547")) }, { status: 500 });
  }
}
