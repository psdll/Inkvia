import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import JSZip from "jszip";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";import { saveBufferFile } from "@/lib/storage";

import { normalizeInspirationCategory } from "@/lib/inspiration-category";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportPayload = {
  version?: number;
  exportedAt?: string;
  template?: {
    title?: string;
    category?: string | null;
    description?: string | null;
    prompt?: string;
    toolType?: "face" | "image" | "video";
    mediaType?: "image" | "video";
    tags?: string[];
    previewImageAsset?: string | null;
    previewVideoAsset?: string | null;
  };
  meta?: {
    version?: number;
    source?: string;
    model?: string | null;
    params?: Record<string, any>;
    inputAssets?: string[];
    outputAssets?: string[];
    createdAt?: string;
  };
};

const TOOL_TYPES = new Set(["face", "image", "video"]);
const MEDIA_TYPES = new Set(["image", "video"]);

function parseJsonSafe(raw: string): ImportPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as ImportPayload;
  } catch {
    return null;
  }
}

function isBatchManifestJson(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed && typeof parsed === "object" && parsed.type === "inspiration_templates_batch");
  } catch {
    return false;
  }
}

function extFromAssetPath(assetPath: string, fallback: string) {
  const m = String(assetPath || "").trim().match(/\.([a-zA-Z0-9]{2,8})$/);
  if (!m) return fallback;
  return m[1].toLowerCase();
}

function mimeFromExt(ext: string) {
  const v = String(ext || "").toLowerCase();
  if (v === "jpg" || v === "jpeg") return "image/jpeg";
  if (v === "png") return "image/png";
  if (v === "webp") return "image/webp";
  if (v === "gif") return "image/gif";
  if (v === "mp4") return "video/mp4";
  if (v === "webm") return "video/webm";
  if (v === "mov") return "video/quicktime";
  if (v === "mkv") return "video/x-matroska";
  return undefined;
}

async function uploadAssetFromZip(
  zip: JSZip,
  assetPath: string | null | undefined,
  folder: string,
  fallbackExt: string
) {
  const p = String(assetPath || "").trim();
  if (!p) return null;
  const file = zip.file(p);
  if (!file) return null;
  const buffer = await file.async("nodebuffer");
  const ext = extFromAssetPath(p, fallbackExt);
  const fileName = `${randomUUID()}.${ext}`;
  return saveBufferFile(buffer, folder, { fileName, contentType: mimeFromExt(ext), fallbackExt: ext });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });
  const formData = await req.formData();
  const pkg = formData.get("package");
  if (!(pkg instanceof File) || pkg.size <= 0) {
    return NextResponse.json({ success: false, error: apiMessage("mfe0e43b73635") }, { status: 400 });
  }

  const zip = await JSZip.loadAsync(Buffer.from(await pkg.arrayBuffer())).catch(() => null);
  if (!zip) return NextResponse.json({ success: false, error: apiMessage("m90f87ad2e2c4") }, { status: 400 });

  const importSingleTemplate = async (currentZip: JSZip) => {
    const config = currentZip.file("template.json");
    if (!config) throw new Error("模板包缺少 template.json");
    const jsonText = await config.async("string");
    const parsed = parseJsonSafe(jsonText);
    if (!parsed?.template) throw new Error("template.json 内容无效");

    const category = normalizeInspirationCategory(parsed.template.category);
    const title = String(parsed.template.title || "").trim();
    const prompt = String(parsed.template.prompt || "").trim();
    const description = String(parsed.template.description || "").trim() || null;
    const toolType = String(parsed.template.toolType || "").trim();
    const mediaType = String(parsed.template.mediaType || "").trim();
    const tags = (Array.isArray(parsed.template.tags) ? parsed.template.tags : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 12);
    if (!title) throw new Error("模板包标题为空");
    if (!prompt) throw new Error("模板包提示词为空");
    if (!TOOL_TYPES.has(toolType)) throw new Error("模板包工具类型不合法");
    if (!MEDIA_TYPES.has(mediaType)) throw new Error("模板包媒体类型不合法");

    const previewImagePath = await uploadAssetFromZip(
      currentZip,
      parsed.template.previewImageAsset || null,
      "inspiration_assets/images",
      "png"
    );
    const previewVideoPath = await uploadAssetFromZip(
      currentZip,
      parsed.template.previewVideoAsset || null,
      "inspiration_assets/videos",
      "mp4"
    );

    const inputAssets = Array.isArray(parsed.meta?.inputAssets) ? parsed.meta?.inputAssets : [];
    const outputAssets = Array.isArray(parsed.meta?.outputAssets) ? parsed.meta?.outputAssets : [];
    const inputPaths: string[] = [];
    const outputPaths: string[] = [];
    for (const asset of inputAssets) {
      const ext = extFromAssetPath(asset, "png");
      const folder = ["mp4", "mov", "webm", "mkv"].includes(ext) ? "inspiration_assets/videos" : "inspiration_assets/images";
      const uploaded = await uploadAssetFromZip(currentZip, asset, folder, "png");
      if (uploaded) inputPaths.push(uploaded);
    }
    for (const asset of outputAssets) {
      const ext = extFromAssetPath(asset, "png");
      const folder = ["mp4", "mov", "webm", "mkv"].includes(ext) ? "inspiration_assets/videos" : "inspiration_assets/images";
      const uploaded = await uploadAssetFromZip(currentZip, asset, folder, "png");
      if (uploaded) outputPaths.push(uploaded);
    }

    let finalPreviewImagePath = previewImagePath;
    let finalPreviewVideoPath = previewVideoPath;
    if (!finalPreviewImagePath && !finalPreviewVideoPath && outputPaths.length) {
      const first = outputPaths[0];
      if (/\/videos\//.test(first)) finalPreviewVideoPath = first;
      else finalPreviewImagePath = first;
    }

    const created = await prisma.template.create({
      data: {
        title,
        category,
        description,
        prompt,
        toolType: toolType as "face" | "image" | "video",
        mediaType: mediaType as "image" | "video",
        previewImagePath: finalPreviewImagePath,
        previewVideoPath: finalPreviewVideoPath,
        tags: {
          create: tags.map((name) => ({
            tag: {
              connectOrCreate: {
                where: { name },
                create: { name }
              }
            }
          }))
        }
      },
      include: { tags: { include: { tag: true } } }
    });

    const metaPayload = {
      version: Number(parsed.meta?.version || 1),
      source: String(parsed.meta?.source || "admin_custom_upload"),
      model: parsed.meta?.model ? String(parsed.meta.model) : null,
      params:
        parsed.meta?.params && typeof parsed.meta.params === "object" && !Array.isArray(parsed.meta.params)
          ? parsed.meta.params
          : {},
      inputPaths,
      outputPaths,
      createdAt: String(parsed.meta?.createdAt || new Date().toISOString())
    };
    await prisma.appSetting.upsert({
      where: { key: `inspiration_template_meta_${created.id}` },
      update: { value: JSON.stringify(metaPayload) },
      create: { key: `inspiration_template_meta_${created.id}`, value: JSON.stringify(metaPayload) }
    });
    return created;
  };

  const manifest = zip.file("manifest.json");
  if (manifest && isBatchManifestJson(await manifest.async("string"))) {
    const candidates = (Object.values(zip.files) as JSZip.JSZipObject[]).filter(
      (entry) => entry.name.startsWith("templates/") && /\.template\.zip$/i.test(entry.name)
    );
    const createdIds: number[] = [];
    for (const entry of candidates) {
      try {
        const nestedBuffer = await entry.async("nodebuffer");
        const nestedZip = await JSZip.loadAsync(nestedBuffer);
        const created = await importSingleTemplate(nestedZip);
        createdIds.push(created.id);
      } catch {
        continue;
      }
    }
    if (!createdIds.length) {
      return NextResponse.json({ success: false, error: apiMessage("mfa4752cc7287") }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      data: {
        importedCount: createdIds.length,
        ids: createdIds
      }
    });
  }

  const created = await importSingleTemplate(zip);
  return NextResponse.json({
    success: true,
    data: {
      id: created.id,
      title: created.title,
      tags: created.tags.map((x) => x.tag.name),
      importedCount: 1
    }
  });
}
