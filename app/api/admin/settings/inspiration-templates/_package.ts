import JSZip from "jszip";
import fs from "fs/promises";
import prisma from "@/lib/prisma";
import { getOssObjectBufferByUrl } from "@/lib/oss";
import { resolvePublicPath } from "@/lib/public-path";

export type TemplateExportPayload = {
  version: number;
  exportedAt: string;
  template: {
    title: string;
    category?: string | null;
    description: string | null;
    prompt: string;
    toolType: string;
    mediaType: string;
    tags: string[];
    previewImageAsset: string | null;
    previewVideoAsset: string | null;
  };
  meta: {
    version: number;
    source: string;
    model: string | null;
    params: Record<string, any>;
    inputAssets: string[];
    outputAssets: string[];
    createdAt: string;
  };
};

type TemplateMeta = {
  version?: number;
  source?: string;
  model?: string | null;
  params?: Record<string, any>;
  inputPaths?: string[];
  outputPaths?: string[];
  createdAt?: string;
};

function parseMeta(value: string | null | undefined): TemplateMeta {
  const raw = String(value || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as TemplateMeta;
    return {};
  } catch {
    return {};
  }
}

export function safeFilePart(input: string, fallback: string) {
  const text = String(input || "").trim();
  if (!text) return fallback;
  const cleaned = text.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function extFromUrl(raw: string, fallback: string) {
  const text = String(raw || "").trim();
  const m = text.match(/\.([a-zA-Z0-9]{2,8})(?:\?.*)?$/);
  if (!m) return fallback;
  return m[1].toLowerCase();
}

async function appendAssetToZip(zip: JSZip, logicalPath: string, sourceUrl: string | null | undefined) {
  const src = String(sourceUrl || "").trim();
  if (!src) return null;
  const buffer = await readStoredAssetBuffer(src);
  if (!buffer) return null;
  zip.file(logicalPath, buffer);
  return logicalPath;
}

async function readStoredAssetBuffer(src: string) {
  if (src.startsWith("/uploads/")) {
    const full = resolvePublicPath(src.replace(/^\/+/, ""));
    try {
      return await fs.readFile(full);
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  return getOssObjectBufferByUrl(src);
}

export async function buildSingleTemplatePackageBufferById(id: number) {
  const found = await prisma.template.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } }
  });
  if (!found) throw new Error("模板不存在");

  const metaSetting = await prisma.appSetting.findUnique({
    where: { key: `inspiration_template_meta_${id}` },
    select: { value: true }
  });
  const meta = parseMeta(metaSetting?.value);

  const zip = new JSZip();
  const mappedInputAssets: string[] = [];
  const mappedOutputAssets: string[] = [];

  const previewImageExt = extFromUrl(found.previewImagePath || "", "png");
  const previewVideoExt = extFromUrl(found.previewVideoPath || "", "mp4");
  const mappedPreviewImage = await appendAssetToZip(zip, `assets/preview_image.${previewImageExt}`, found.previewImagePath);
  const mappedPreviewVideo = await appendAssetToZip(zip, `assets/preview_video.${previewVideoExt}`, found.previewVideoPath);

  const inputPaths = Array.isArray(meta.inputPaths) ? meta.inputPaths : [];
  const outputPaths = Array.isArray(meta.outputPaths) ? meta.outputPaths : [];
  for (let i = 0; i < inputPaths.length; i += 1) {
    const src = String(inputPaths[i] || "").trim();
    if (!src) continue;
    const ext = extFromUrl(src, "png");
    const mapped = await appendAssetToZip(zip, `assets/input_${String(i + 1).padStart(2, "0")}.${ext}`, src);
    if (mapped) mappedInputAssets.push(mapped);
  }
  for (let i = 0; i < outputPaths.length; i += 1) {
    const src = String(outputPaths[i] || "").trim();
    if (!src) continue;
    const ext = extFromUrl(src, "png");
    const mapped = await appendAssetToZip(zip, `assets/output_${String(i + 1).padStart(2, "0")}.${ext}`, src);
    if (mapped) mappedOutputAssets.push(mapped);
  }

  const payload: TemplateExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      title: found.title,
      category: found.category,
      description: found.description,
      prompt: found.prompt,
      toolType: found.toolType,
      mediaType: found.mediaType,
      tags: found.tags.map((x) => x.tag.name),
      previewImageAsset: mappedPreviewImage,
      previewVideoAsset: mappedPreviewVideo
    },
    meta: {
      version: Number(meta.version || 1),
      source: String(meta.source || "admin_custom_upload"),
      model: meta.model || null,
      params: meta.params && typeof meta.params === "object" && !Array.isArray(meta.params) ? meta.params : {},
      inputAssets: mappedInputAssets,
      outputAssets: mappedOutputAssets,
      createdAt: String(meta.createdAt || "")
    }
  };
  zip.file("template.json", JSON.stringify(payload, null, 2));

  // 用 uint8array 而非 nodebuffer：Uint8Array 是合法的 BodyInit
  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const fileName = `${safeFilePart(found.title, `template_${id}`)}.template.zip`;
  return { id: found.id, title: found.title, buffer, fileName };
}
