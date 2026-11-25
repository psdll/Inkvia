import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import crypto from "crypto";
import { execFile } from "child_process";
import { promises as fsp } from "fs";
import fs from "fs-extra";
import os from "os";
import path from "path";
import sharp from "sharp";
import { promisify } from "util";
import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);
const prisma = createGuardedPrismaClient();

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");

const PRODUCT_PREVIEWS = "products/previews/generated";
const PRODUCT_POSTERS = "products/posters/generated";
const MATERIAL_THUMBS = "material_library/thumbs";
const MATERIAL_PREVIEWS = "material_library/previews";
const MATERIAL_POSTERS = "material_library/posters";
const INSPIRATION_PREVIEWS = "inspiration_assets/previews";
const INSPIRATION_POSTERS = "inspiration_assets/posters";
const GENERATION_PREVIEWS = "generation_previews";
const GENERATION_POSTERS = "generation_posters";

function uploadsRoot() {
  const configured = String(process.env.UPLOADS_DIR || "").trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "public", "uploads");
}

function normalizeMediaUrl(raw) {
  const text = String(raw || "").trim().replaceAll("\\", "/");
  if (!text || text === "null" || text === "undefined") return "";
  if (text.startsWith("/uploads/")) return text;
  if (text.startsWith("uploads/")) return `/${text}`;
  try {
    const url = new URL(text);
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.pathname.startsWith("/uploads/")) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return text;
  }
}

function isGeneratedDisplayAsset(raw) {
  const value = normalizeMediaUrl(raw);
  return /^\/uploads\/(?:products\/(?:previews|posters|thumbs)|material_library\/(?:previews|posters|thumbs)|materials\/thumbs|inspiration_assets\/(?:previews|posters)|generation_(?:previews|posters))\//.test(value);
}

function isVideoUrl(raw) {
  const base = normalizeMediaUrl(raw).toLowerCase().split("?")[0]?.split("#")[0] || "";
  return [".mp4", ".webm", ".mov", ".m4v", ".mkv"].some((ext) => base.endsWith(ext));
}

function isImageUrl(raw) {
  const base = normalizeMediaUrl(raw).toLowerCase().split("?")[0]?.split("#")[0] || "";
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"].some((ext) => base.endsWith(ext));
}

function isVideoMedia(kind, mime, url) {
  return kind === "video" || String(mime || "").toLowerCase().startsWith("video/") || isVideoUrl(url);
}

function isImageMedia(kind, mime, url) {
  return kind === "image" || String(mime || "").toLowerCase().startsWith("image/") || isImageUrl(url);
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isVideoGeneration(type, url) {
  const t = String(type || "").toLowerCase();
  return t === "video_gen" || t === "video_generate" || isVideoUrl(url);
}

function localDiskPath(raw) {
  const value = normalizeMediaUrl(raw);
  if (!value.startsWith("/uploads/")) return null;
  const relative = value.replace(/^\/uploads\//, "").split("?")[0].split("#")[0];
  if (!relative || relative.includes("..") || path.isAbsolute(relative)) return null;
  return path.join(uploadsRoot(), relative);
}

async function readBuffer(raw) {
  const local = localDiskPath(raw);
  if (local && (await fs.pathExists(local))) return fs.readFile(local);

  const value = normalizeMediaUrl(raw);
  if (!/^https?:\/\//i.test(value)) return null;
  const response = await fetch(value, {
    headers: { accept: "*/*", "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

function hashBuffer(input) {
  return crypto
    .createHash("sha1")
    .update(input.subarray(0, Math.min(input.length, 1024 * 1024)))
    .update(String(input.length))
    .digest("hex")
    .slice(0, 24);
}

async function hashLocalFile(filePath) {
  const stat = await fs.stat(filePath);
  const fd = await fsp.open(filePath, "r");
  try {
    const sample = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
    await fd.read(sample, 0, sample.length, 0);
    return crypto.createHash("sha1").update(sample).update(String(stat.size)).digest("hex").slice(0, 24);
  } finally {
    await fd.close();
  }
}

async function saveGenerated(buffer, folder, hash) {
  const date = new Date().toISOString().split("T")[0];
  const dir = path.join(uploadsRoot(), folder, date);
  const fileName = `${hash}.webp`;
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, fileName), buffer);
  return `/uploads/${folder}/${date}/${fileName}`;
}

async function createImagePreview(raw, folder, options = {}) {
  const input = await readBuffer(raw);
  if (!input?.length) return null;
  const preview = await sharp(input, { animated: false })
    .rotate()
    .resize({
      width: options.width || 1280,
      height: options.height || 1280,
      fit: options.fit || "inside",
      withoutEnlargement: true,
      background: options.background || undefined,
    })
    .webp({ quality: options.quality || 84, effort: 4 })
    .toBuffer();
  return saveGenerated(preview, folder, hashBuffer(input));
}

async function createVideoPoster(raw, folder) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inkvia-backfill-poster-"));
  const local = localDiskPath(raw);
  let inputPath = local && (await fs.pathExists(local)) ? local : null;
  try {
    let hash = inputPath ? await hashLocalFile(inputPath) : "";
    if (!inputPath) {
      const input = await readBuffer(raw);
      if (!input?.length) return null;
      inputPath = path.join(tempDir, "source.mp4");
      hash = hashBuffer(input);
      await fs.writeFile(inputPath, input);
    }

    const framePath = path.join(tempDir, "frame.jpg");
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        "0.25",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:-2:force_original_aspect_ratio=decrease",
        "-q:v",
        "3",
        "-update",
        "1",
        framePath,
      ],
      { timeout: 20000, windowsHide: true }
    );
    const frame = await fs.readFile(framePath);
    const poster = await sharp(frame, { failOn: "none" })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();
    return saveGenerated(poster, folder, hash);
  } finally {
    await fs.remove(tempDir).catch(() => undefined);
  }
}

async function backfillProductLibrary(stats) {
  const rows = await prisma.mediaLibraryItem.findMany({
    where: { isDeleted: false },
    select: { id: true, kind: true, mimeType: true, fileUrl: true, thumbnailUrl: true },
    orderBy: { id: "asc" },
  });
  stats.productLibrary.scanned = rows.length;

  for (const row of rows) {
    if (!force && isGeneratedDisplayAsset(row.thumbnailUrl)) {
      stats.productLibrary.skipped += 1;
      continue;
    }
    const source = row.fileUrl || row.thumbnailUrl;
    if (!source) {
      stats.productLibrary.failed += 1;
      continue;
    }
    if (!apply) {
      stats.productLibrary.generated += 1;
      continue;
    }

    try {
      let displayUrl = null;
      if (isVideoMedia(row.kind, row.mimeType, source)) {
        displayUrl = await createVideoPoster(source, PRODUCT_POSTERS);
      } else if (isImageMedia(row.kind, row.mimeType, source)) {
        displayUrl = await createImagePreview(source, PRODUCT_PREVIEWS);
      }
      if (!displayUrl) {
        stats.productLibrary.failed += 1;
        continue;
      }
      stats.productLibrary.generated += 1;
      await prisma.mediaLibraryItem.update({ where: { id: row.id }, data: { thumbnailUrl: displayUrl } });
      stats.productLibrary.updated += 1;
    } catch (error) {
      stats.productLibrary.failed += 1;
      console.warn(`[product-library] ${row.id} failed: ${error?.message || error}`);
    }
  }
}

async function backfillMaterialAssets(stats) {
  const rows = await prisma.materialAsset.findMany({
    where: { isDeleted: false },
    select: { id: true, imageUrl: true, thumbnailUrl: true, previewUrl: true, mimeType: true },
    orderBy: { id: "asc" },
  });
  stats.materialAssets.scanned = rows.length;

  for (const row of rows) {
    const source = row.imageUrl || row.previewUrl || row.thumbnailUrl;
    if (!source) {
      stats.materialAssets.failed += 1;
      continue;
    }
    if (!force && isGeneratedDisplayAsset(row.previewUrl)) {
      stats.materialAssets.skipped += 1;
      continue;
    }
    if (!apply) {
      stats.materialAssets.generated += 1;
      continue;
    }

    try {
      const data = {};
      if (isVideoMedia("", row.mimeType, source)) {
        const poster = await createVideoPoster(source, MATERIAL_POSTERS);
        if (poster) {
          data.previewUrl = poster;
          data.thumbnailUrl = poster;
        }
      } else if (isImageMedia("", row.mimeType, source)) {
        const preview = await createImagePreview(source, MATERIAL_PREVIEWS);
        const thumb = await createImagePreview(source, MATERIAL_THUMBS, {
          width: 360,
          height: 270,
          fit: "contain",
          quality: 82,
          background: { r: 246, g: 247, b: 251, alpha: 1 },
        });
        if (preview) data.previewUrl = preview;
        if (thumb) data.thumbnailUrl = thumb;
      }
      if (!Object.keys(data).length) {
        stats.materialAssets.failed += 1;
        continue;
      }
      stats.materialAssets.generated += 1;
      await prisma.materialAsset.update({ where: { id: row.id }, data });
      stats.materialAssets.updated += 1;
    } catch (error) {
      stats.materialAssets.failed += 1;
      console.warn(`[material-assets] ${row.id} failed: ${error?.message || error}`);
    }
  }
}

async function backfillInspirationTemplates(stats) {
  const rows = await prisma.template.findMany({
    select: { id: true, mediaType: true, previewImagePath: true, previewVideoPath: true },
    orderBy: { id: "asc" },
  });
  stats.inspirationTemplates.scanned = rows.length;

  for (const row of rows) {
    if (!force && isGeneratedDisplayAsset(row.previewImagePath)) {
      stats.inspirationTemplates.skipped += 1;
      continue;
    }
    const isVideo = isVideoMedia(row.mediaType, "", row.previewVideoPath || row.previewImagePath);
    const source = isVideo ? row.previewVideoPath || row.previewImagePath : row.previewImagePath || row.previewVideoPath;
    if (!source) {
      stats.inspirationTemplates.failed += 1;
      continue;
    }
    if (!apply) {
      stats.inspirationTemplates.generated += 1;
      continue;
    }

    try {
      let previewImagePath = null;
      if (isVideo) {
        previewImagePath = await createVideoPoster(source, INSPIRATION_POSTERS);
      } else if (isImageMedia(row.mediaType, "", source)) {
        previewImagePath = await createImagePreview(source, INSPIRATION_PREVIEWS);
      }
      if (!previewImagePath) {
        stats.inspirationTemplates.failed += 1;
        continue;
      }
      stats.inspirationTemplates.generated += 1;
      await prisma.template.update({ where: { id: row.id }, data: { previewImagePath } });
      stats.inspirationTemplates.updated += 1;
    } catch (error) {
      stats.inspirationTemplates.failed += 1;
      console.warn(`[inspiration-templates] ${row.id} failed: ${error?.message || error}`);
    }
  }
}

async function backfillGenerations(stats) {
  const rows = await prisma.generation.findMany({
    where: {
      status: "success",
      localPath: { not: null },
      type: { not: "import" },
    },
    select: { id: true, type: true, localPath: true, templateData: true },
    orderBy: { id: "asc" },
  });
  stats.generations.scanned = rows.length;

  for (const row of rows) {
    const source = normalizeMediaUrl(row.localPath || "");
    if (!source) {
      stats.generations.failed += 1;
      continue;
    }
    const meta = parseJsonObject(row.templateData);
    if (!force && isGeneratedDisplayAsset(meta.outputDisplayUrl || meta.outputPreviewUrl || meta.outputPosterUrl)) {
      stats.generations.skipped += 1;
      continue;
    }
    if (!apply) {
      stats.generations.generated += 1;
      continue;
    }

    try {
      const patch = {};
      if (isVideoGeneration(row.type, source)) {
        const poster = await createVideoPoster(source, GENERATION_POSTERS);
        if (poster) {
          patch.outputDisplayUrl = poster;
          patch.outputPosterUrl = poster;
          patch.outputDisplayKind = "video";
          patch.outputOriginalUrl = source;
        }
      } else {
        const preview = await createImagePreview(source, GENERATION_PREVIEWS);
        if (preview) {
          patch.outputDisplayUrl = preview;
          patch.outputPreviewUrl = preview;
          patch.outputDisplayKind = "image";
          patch.outputOriginalUrl = source;
        }
      }
      if (!Object.keys(patch).length) {
        stats.generations.failed += 1;
        continue;
      }
      stats.generations.generated += 1;
      await prisma.generation.update({
        where: { id: row.id },
        data: { templateData: JSON.stringify({ ...meta, ...patch }) },
      });
      stats.generations.updated += 1;
    } catch (error) {
      stats.generations.failed += 1;
      console.warn(`[generations] ${row.id} failed: ${error?.message || error}`);
    }
  }
}

function emptyStats() {
  return { scanned: 0, skipped: 0, generated: 0, updated: 0, failed: 0 };
}

const stats = {
  apply,
  force,
  uploadsRoot: uploadsRoot(),
  productLibrary: emptyStats(),
  materialAssets: emptyStats(),
  inspirationTemplates: emptyStats(),
  generations: emptyStats(),
};

try {
  await backfillProductLibrary(stats);
  await backfillMaterialAssets(stats);
  await backfillInspirationTemplates(stats);
  await backfillGenerations(stats);
  console.log(JSON.stringify(stats, null, 2));
} finally {
  await prisma.$disconnect();
}
