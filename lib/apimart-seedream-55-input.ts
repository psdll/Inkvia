import sharp from "sharp";
import fs from "node:fs/promises";
import { resolveLocalUploadPath } from "@/lib/tool-media/media-probe";

/** Inspect the stored file that is relayed unchanged to APIMart. */
export async function validateSeedream55Reference(localPath: string) {
  const file = resolveLocalUploadPath(localPath);
  const stat = await fs.stat(file);
  if (stat.size > 30 * 1024 * 1024) throw new Error("Seedream 5.5 参考图每张不能超过 30 MB");
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height || meta.width * (meta.pageHeight || meta.height) > 36000000) throw new Error("Seedream 5.5 参考图总像素不能超过 3600 万");
  if (!["jpeg", "png", "webp", "bmp", "tiff", "gif", "heif"].includes(meta.format || "") || (meta.format === "heif" && meta.compression === "av1")) throw new Error("Seedream 5.5 参考图不支持此格式，请上传 JPEG、PNG、WebP、BMP、TIFF、GIF 或 HEIC/HEIF");
}
