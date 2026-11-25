import sharp from "sharp";
import { resolveLocalUploadPath } from "@/lib/tool-media/media-probe";
import { validateSeedream55Reference } from "./apimart-seedream-55-input";

export async function validateVolcSeedream55Reference(localPath: string, layers: boolean) {
  await validateSeedream55Reference(localPath);
  const meta = await sharp(resolveLocalUploadPath(localPath)).metadata();
  const width = meta.width || 0, height = meta.pageHeight || meta.height || 0;
  if (width < 14 || height < 14 || width / height < 1 / 16 || width / height > 16) throw new Error("Seedream 5.5 参考图宽高至少 14 像素，宽高比须在 1:16–16:1 之间");
  if (layers && (!["png", "jpeg"].includes(meta.format || "") || width * height < 262144)) throw new Error("图层拆分需要 PNG 或 JPEG 图片，总像素至少 262144");
}
