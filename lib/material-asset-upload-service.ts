import * as yauzl from "yauzl";
import prisma from "@/lib/prisma";
import {
  createMediaLibraryImagePreview,
  createMaterialCardThumbnail,
  createMediaLibraryVideoPoster,
} from "@/lib/media-library-thumbnails";
import { saveBufferFile } from "@/lib/storage";
import { validateUploadFile } from "@/lib/upload-validation";
import {
  buildMaterialAssetTitle,
  normalizeMaterialAssetCategory,
  parseMaterialAssetTags,
  stringifyMaterialAssetTags,
} from "@/lib/material-assets";
import {
  normalizeMaterialAssetOptionValue,
  upsertMaterialAssetOptions,
} from "@/lib/material-asset-options";
import {
  MATERIAL_ASSET_ORIGINALS_FOLDER,
  MATERIAL_ASSET_POSTERS_FOLDER,
  MATERIAL_ASSET_PREVIEWS_FOLDER,
  MATERIAL_ASSET_THUMBNAILS_FOLDER,
} from "@/lib/upload-buckets";
import {
  createMaterialAssetMediaId,
  materialAssetCoverPatch,
  MAX_MATERIAL_ASSET_GROUP_MEDIA,
  reorderMaterialAssetMedia,
  type MaterialAssetMediaItem,
} from "@/lib/material-asset-media";
import {
  MAX_UPLOAD_FILE_COUNT,
  MAX_UPLOAD_REQUEST_BYTES,
  MAX_ZIP_ENTRY_COUNT,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  assertUploadBatchWithinLimits,
} from "@/lib/upload-limits";

export class MaterialAssetUploadError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MaterialAssetUploadError";
    this.status = status;
  }
}

type UploadInputFile = {
  name: string;
  type: string;
  size: number;
  buffer: Buffer;
};

export type MaterialAssetUploadResult = {
  success: true;
  count: number;
  items: Array<{
    id: number;
    category: string | null;
    title: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    previewUrl: string | null;
    mimeType: string | null;
    sizeBytes: number;
    mediaCount: number;
    tags: string[];
    creatorName: string | null;
    modelName: string | null;
    createdAt: string;
  }>;
};

function safeFileName(name: string) {
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
  const base =
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w\u4e00-\u9fa5-]+/g, "_")
      .slice(0, 60) || "material";
  return `material_${Date.now()}_${base}${ext}`;
}

const GROUP_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
]);

function extToMime(ext: string) {
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
  };
  return map[ext] || "application/octet-stream";
}

function isZipFile(file: File) {
  return (
    /\.zip$/i.test(file.name) ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

function isImageInput(file: Pick<UploadInputFile, "name" | "type">) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return (
    String(file.type || "")
      .toLowerCase()
      .startsWith("image/") || GROUP_IMAGE_EXTENSIONS.has(ext)
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    }),
  );
  return results;
}

function openZipFromBuffer(buffer: Buffer) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) reject(err || new Error("ZIP 文件无法打开"));
      else resolve(zipfile);
    });
  });
}

function openZipEntryStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err || new Error("ZIP 条目无法读取"));
      else resolve(stream);
    });
  });
}

async function readStreamBuffer(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
) {
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        reject(new MaterialAssetUploadError("ZIP 解包后图片过大", 400));
        return;
      }
      chunks.push(buf);
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

async function extractImageFilesFromZip(
  file: File,
): Promise<UploadInputFile[]> {
  const zipBuffer = Buffer.from(await file.arrayBuffer());
  const zipfile = await openZipFromBuffer(zipBuffer);
  const entries: yauzl.Entry[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on("error", reject);
      zipfile.on("end", resolve);
      zipfile.on("entry", (entry) => {
        const name = String(entry.fileName || "").replace(/\\/g, "/");
        const base = name.split("/").pop() || name;
        const ext = (base.split(".").pop() || "").toLowerCase();
        if (
          !/\/$/.test(name) &&
          base &&
          !base.startsWith(".") &&
          !name.includes("__MACOSX/") &&
          GROUP_IMAGE_EXTENSIONS.has(ext)
        ) {
          entries.push(entry);
        }
        zipfile.readEntry();
      });
      zipfile.readEntry();
    });

    const sorted = entries.sort((a, b) =>
      String(a.fileName).localeCompare(String(b.fileName), "zh-CN"),
    );
    if (sorted.length > MAX_ZIP_ENTRY_COUNT) {
      throw new MaterialAssetUploadError(
        `ZIP 文件数量不能超过 ${MAX_ZIP_ENTRY_COUNT} 个`,
        400,
      );
    }
    const declaredUncompressedBytes = sorted.reduce(
      (sum, entry) => sum + Math.max(0, Number(entry.uncompressedSize) || 0),
      0,
    );
    if (declaredUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new MaterialAssetUploadError("ZIP 解压后总大小不能超过 300MB", 400);
    }

    const files: UploadInputFile[] = [];
    let actualUncompressedBytes = 0;
    for (const entry of sorted) {
      const base =
        String(entry.fileName || "image")
          .replace(/\\/g, "/")
          .split("/")
          .pop() || "image";
      const ext = (base.split(".").pop() || "").toLowerCase();
      const stream = await openZipEntryStream(zipfile, entry);
      const buffer = await readStreamBuffer(stream, 30 * 1024 * 1024);
      actualUncompressedBytes += buffer.length;
      if (actualUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new MaterialAssetUploadError(
          "ZIP 解压后总大小不能超过 300MB",
          400,
        );
      }
      files.push({
        name: base,
        type: extToMime(ext),
        size: buffer.length,
        buffer,
      });
    }
    return files;
  } finally {
    zipfile.close();
  }
}

async function fileToUploadInput(file: File): Promise<UploadInputFile> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    name: file.name,
    type: file.type || "",
    size: Number(file.size) || buffer.length,
    buffer,
  };
}

async function buildStoredMedia(
  file: UploadInputFile,
  kind: "image" | "video",
): Promise<MaterialAssetMediaItem> {
  const imageUrl = await saveBufferFile(
    file.buffer,
    MATERIAL_ASSET_ORIGINALS_FOLDER,
    {
      fileName: safeFileName(file.name),
      contentType: file.type || undefined,
      fallbackExt: kind === "video" ? "mp4" : "png",
    },
  );
  let width: number | null = null;
  let height: number | null = null;
  let thumbnailUrl = imageUrl;
  let previewUrl = imageUrl;
  if (kind === "video") {
    const posterUrl =
      (await createMediaLibraryVideoPoster(file.buffer, {
        contentType: file.type || undefined,
        folder: MATERIAL_ASSET_POSTERS_FOLDER,
        kind,
        sourceName: file.name,
      })) || imageUrl;
    thumbnailUrl = posterUrl;
    previewUrl = posterUrl;
  } else {
    const card = await createMaterialCardThumbnail(file.buffer, {
      contentType: file.type || undefined, folder: MATERIAL_ASSET_THUMBNAILS_FOLDER, kind, sourceName: file.name,
    });
    thumbnailUrl = card?.url || imageUrl;
    width = card?.width || null; height = card?.height || null;
    previewUrl =
      (await createMediaLibraryImagePreview(file.buffer, {
        contentType: file.type || undefined,
        folder: MATERIAL_ASSET_PREVIEWS_FOLDER,
        kind,
        sourceName: file.name,
      })) || imageUrl;
  }
  return {
    id: createMaterialAssetMediaId(),
    ...(width && height ? { width, height } : {}),
    originalUrl: imageUrl,
    thumbnailUrl,
    previewUrl,
    mime: file.type || null,
    size: Number(file.size) || file.buffer.length || null,
  };
}

export async function uploadMaterialAssetsFromForm(
  form: FormData,
  options: { createdByUserId: number | null },
): Promise<MaterialAssetUploadResult> {
  const category = normalizeMaterialAssetCategory(form.get("category"));
  const tags = parseMaterialAssetTags(form.get("tags"));
  const creatorName = normalizeMaterialAssetOptionValue(
    "creator",
    form.get("creatorName"),
  );
  const modelName = normalizeMaterialAssetOptionValue(
    "model",
    form.get("modelName"),
  );
  const uploadMode =
    String(form.get("uploadMode") || "single").trim() === "group"
      ? "group"
      : "single";
  const coverIndex = Math.max(
    0,
    Math.floor(Number(form.get("coverIndex") || "0")) || 0,
  );
  const formFiles = [...form.getAll("files"), form.get("file")].filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  );
  assertUploadBatchWithinLimits(formFiles, {
    maxFiles: MAX_UPLOAD_FILE_COUNT,
    maxTotalBytes: MAX_UPLOAD_REQUEST_BYTES,
    label: "Material upload",
  });

  if (!formFiles.length) {
    throw new MaterialAssetUploadError("请先选择素材图片", 400);
  }

  if (uploadMode === "group") {
    const expanded: UploadInputFile[] = [];
    for (const file of formFiles) {
      if (isZipFile(file))
        expanded.push(...(await extractImageFilesFromZip(file)));
      else expanded.push(await fileToUploadInput(file));
    }
    if (!expanded.length) {
      throw new MaterialAssetUploadError(
        "ZIP 中没有可用图片，或未选择图片",
        400,
      );
    }
    if (expanded.length > MAX_MATERIAL_ASSET_GROUP_MEDIA) {
      throw new MaterialAssetUploadError(
        `单个系列图最大 ${MAX_MATERIAL_ASSET_GROUP_MEDIA} 张`,
        400,
      );
    }
    for (const file of expanded) {
      if (!isImageInput(file)) {
        throw new MaterialAssetUploadError(
          "系列图素材仅支持图片，不能包含视频",
          400,
        );
      }
      const validationBody = file.buffer.buffer.slice(
        file.buffer.byteOffset,
        file.buffer.byteOffset + file.buffer.byteLength,
      ) as ArrayBuffer;
      const validationFile = new File([validationBody], file.name, {
        type: file.type || "application/octet-stream",
      });
      const validation = await validateUploadFile(validationFile, ["image"], {
        image: 30 * 1024 * 1024,
      });
      if (!validation.ok) {
        throw new MaterialAssetUploadError(
          `${file.name}：${validation.error || "文件校验失败"}`,
          400,
        );
      }
    }

    const media = reorderMaterialAssetMedia(
      await mapWithConcurrency(expanded, 3, (file) =>
        buildStoredMedia(file, "image"),
      ),
      coverIndex,
    );
    const coverPatch = materialAssetCoverPatch(media);
    const title = buildMaterialAssetTitle(
      form.get("title"),
      expanded[0]?.name || "系列图素材",
      0,
    );
    const created = await prisma.$transaction(async (tx) => {
      await upsertMaterialAssetOptions(tx, {
        category,
        creatorName,
        modelName,
      });
      return tx.materialAsset.create({
        data: {
          category,
          title,
          ...coverPatch,
          tags: stringifyMaterialAssetTags(tags),
          creatorName,
          modelName,
          sortOrder: 0,
          listedAt: new Date(),
          createdByUserId: options.createdByUserId,
          isDeleted: false,
        },
      });
    });
    return {
      success: true,
      count: 1,
      items: [
        {
          id: created.id,
          category,
          title,
          imageUrl: created.imageUrl,
          thumbnailUrl: created.thumbnailUrl,
          previewUrl: created.previewUrl,
          mimeType: created.mimeType,
          sizeBytes: created.sizeBytes || 0,
          mediaCount: created.mediaCount,
          tags,
          creatorName,
          modelName,
          createdAt: created.createdAt.toISOString(),
        },
      ],
    };
  }

  const validations = [];
  for (const file of formFiles) {
    const validation = await validateUploadFile(file, ["image", "video"], {
      image: 30 * 1024 * 1024,
    });
    if (!validation.ok) {
      throw new MaterialAssetUploadError(
        `${file.name}：${validation.error || "文件校验失败"}`,
        400,
      );
    }
    validations.push(validation);
  }

  const items = [];
  for (const [index, file] of formFiles.entries()) {
    const kind = validations[index]?.kind === "video" ? "video" : "image";
    const input = await fileToUploadInput(file);
    const media = await buildStoredMedia(input, kind);
    const coverPatch = materialAssetCoverPatch([media]);
    const title = buildMaterialAssetTitle(
      form.get("title"),
      file.name,
      index + 1,
    );

    const created = await prisma.$transaction(async (tx) => {
      await upsertMaterialAssetOptions(tx, {
        category,
        creatorName,
        modelName,
      });
      return tx.materialAsset.create({
        data: {
          category,
          title,
          ...coverPatch,
          tags: stringifyMaterialAssetTags(tags),
          creatorName,
          modelName,
          sortOrder: 0,
          listedAt: new Date(),
          createdByUserId: options.createdByUserId,
          isDeleted: false,
        },
      });
    });

    items.push({
      id: created.id,
      category,
      title,
      imageUrl: created.imageUrl,
      thumbnailUrl: created.thumbnailUrl,
      previewUrl: created.previewUrl,
      mimeType: created.mimeType,
      sizeBytes: created.sizeBytes || 0,
      mediaCount: created.mediaCount,
      tags,
      creatorName,
      modelName,
      createdAt: created.createdAt.toISOString(),
    });
  }

  return { success: true, count: items.length, items };
}
