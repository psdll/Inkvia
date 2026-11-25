import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";import { saveBufferFile, saveUploadedFile } from "@/lib/storage";
import { createMediaLibraryImagePreview, createMediaLibraryVideoPoster } from "@/lib/media-library-thumbnails";
import { getTemplateSourceLabel, loadTemplateMetaByIds } from "@/lib/inspiration-template-service";

import { normalizeInspirationCategory } from "@/lib/inspiration-category";

export const dynamic = "force-dynamic";

const TOOL_TYPES = ["image", "video"] as const;
const MEDIA_TYPES = ["image", "video"] as const;
const INSPIRATION_OSS_BASE = "inspiration_assets";

function asToolType(value: string | null) {
  if (!value) return null;
  if ((TOOL_TYPES as readonly string[]).includes(value)) return value as (typeof TOOL_TYPES)[number];
  return null;
}

function asMediaType(value: string | null) {
  if (!value) return null;
  if ((MEDIA_TYPES as readonly string[]).includes(value)) return value as (typeof MEDIA_TYPES)[number];
  return null;
}

function asNumber(value: string | null, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function getExtensionFromFilename(filename: string) {
  const name = String(filename || "").trim().toLowerCase();
  const m = name.match(/\.([a-z0-9]{1,8})$/i);
  if (!m) return "";
  return m[1];
}

function getExtensionFromMime(mime: string) {
  const m = String(mime || "").trim().toLowerCase().split(";")[0];
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "video/mp4") return "mp4";
  if (m === "video/webm") return "webm";
  if (m === "video/quicktime") return "mov";
  if (m === "video/x-matroska") return "mkv";
  return "";
}

function inferMediaTypeFromFile(file: File): "image" | "video" {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  const ext = getExtensionFromFilename(file.name);
  if (["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(ext)) return "video";
  return "image";
}

function parseParamsJson(value: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, any>;
  } catch {
    return null;
  }
}

async function uploadTemplateFileToOss(file: File, folder: string, fallbackExt: string) {
  return saveUploadedFile(file, folder);
}

async function createTemplateImagePreview(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return createMediaLibraryImagePreview(buffer, {
    contentType: file.type || undefined,
    folder: `${INSPIRATION_OSS_BASE}/previews`,
    kind: "image",
    sourceName: file.name,
  });
}

async function createTemplateVideoPoster(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return createMediaLibraryVideoPoster(buffer, {
    contentType: file.type || undefined,
    folder: `${INSPIRATION_OSS_BASE}/posters`,
    kind: "video",
    sourceName: file.name,
  });
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const take = Math.min(asNumber(searchParams.get("take"), 24), 60);
  const skip = asNumber(searchParams.get("skip"), 0);

  const [items, total] = await Promise.all([
    prisma.template.findMany({
      take,
      skip,
      // 管理端“最近上传”严格按时间倒序
      orderBy: [{ createdAt: "desc" }],
      include: { tags: { include: { tag: true } } }
    }),
    prisma.template.count()
  ]);

  const metaById = await loadTemplateMetaByIds(items.map((item) => item.id));

  return NextResponse.json({
    success: true,
    data: items.map((t) => ({
      ...t,
      tags: t.tags.map((x) => x.tag.name),
      sourceLabel: getTemplateSourceLabel(metaById.get(t.id))
    })),
    meta: { total, take, skip }
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });
  const formData = await req.formData();
  let category: string | null;
  try { category = normalizeInspirationCategory(formData.get("category")); }
  catch (error) { return NextResponse.json({ success: false, error: apiErrorMessage((error as Error).message) }, { status: 400 }); }
  const title = String(formData.get("title") || "").trim();
  const prompt = String(formData.get("prompt") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const toolType = asToolType(String(formData.get("toolType") || ""));
  const mediaType = asMediaType(String(formData.get("mediaType") || ""));
  const tagsRaw = String(formData.get("tags") || "");
  const model = String(formData.get("model") || "").trim() || null;
  const paramsJsonRaw = String(formData.get("paramsJson") || "").trim();
  const parsedParams = parseParamsJson(paramsJsonRaw);
  const tags = tagsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (!title) return NextResponse.json({ success: false, error: apiMessage("m9494a032b281") }, { status: 400 });
  if (!prompt) return NextResponse.json({ success: false, error: apiMessage("me7ce7fbc55ea") }, { status: 400 });
  if (!toolType) return NextResponse.json({ success: false, error: apiMessage("m7cc727c03849") }, { status: 400 });
  if (!mediaType) return NextResponse.json({ success: false, error: apiMessage("m0ccc9a97147c") }, { status: 400 });
  if (paramsJsonRaw && !parsedParams) {
    return NextResponse.json({ success: false, error: apiMessage("ma0e56fdc3fed") }, { status: 400 });
  }

  const previewImage = formData.get("previewImage");
  const previewVideo = formData.get("previewVideo");
  let previewImagePath: string | null = null;
  let previewVideoPath: string | null = null;

  if (previewImage instanceof File && previewImage.size > 0) {
    const previewBuffer = Buffer.from(await previewImage.arrayBuffer());
    previewImagePath =
      (await createMediaLibraryImagePreview(previewBuffer, {
        contentType: previewImage.type || undefined,
        folder: `${INSPIRATION_OSS_BASE}/previews`,
        kind: "image",
        sourceName: previewImage.name,
      })) ||
      (await saveBufferFile(previewBuffer, `${INSPIRATION_OSS_BASE}/images`, {
        fileName: previewImage.name,
        contentType: previewImage.type || undefined,
        fallbackExt: "png",
      }));
  }
  if (previewVideo instanceof File && previewVideo.size > 0) {
    previewVideoPath = await uploadTemplateFileToOss(previewVideo, `${INSPIRATION_OSS_BASE}/videos`, "mp4");
    previewImagePath = previewImagePath || (await createTemplateVideoPoster(previewVideo));
  }
  const inputFiles = formData
    .getAll("inputFiles")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const outputFiles = formData
    .getAll("outputFiles")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const inputPaths: string[] = [];
  const outputPaths: string[] = [];
  for (const file of inputFiles) {
    const kind = inferMediaTypeFromFile(file);
    const folder = kind === "video" ? `${INSPIRATION_OSS_BASE}/videos` : `${INSPIRATION_OSS_BASE}/images`;
    const fallback = kind === "video" ? "mp4" : "png";
    inputPaths.push(await uploadTemplateFileToOss(file, folder, fallback));
  }
  for (const file of outputFiles) {
    const kind = inferMediaTypeFromFile(file);
    const folder = kind === "video" ? `${INSPIRATION_OSS_BASE}/videos` : `${INSPIRATION_OSS_BASE}/images`;
    const fallback = kind === "video" ? "mp4" : "png";
    const storedPath = await uploadTemplateFileToOss(file, folder, fallback);
    outputPaths.push(storedPath);
    if (!previewImagePath && kind === "image") {
      previewImagePath = await createTemplateImagePreview(file);
    }
    if (kind === "video") {
      previewVideoPath = previewVideoPath || storedPath;
      previewImagePath = previewImagePath || (await createTemplateVideoPoster(file));
    }
  }
  if (!previewImagePath && !previewVideoPath && outputPaths.length) {
    const preferred = outputPaths.find((p) => (mediaType === "video" ? /\/videos\//.test(p) : /\/images\//.test(p))) || outputPaths[0];
    if (/\/videos\//.test(preferred)) previewVideoPath = preferred;
    else previewImagePath = preferred;
  }

  const record = await prisma.template.create({
    data: {
      title,
      category,
      description,
      prompt,
      toolType,
      mediaType,
      previewImagePath,
      previewVideoPath,
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
  const detailPayload = {
    version: 1,
    source: "admin_custom_upload",
    model,
    params: { ...(parsedParams || {}), ...(model ? { model } : {}) },
    inputPaths,
    outputPaths,
    createdAt: new Date().toISOString()
  };
  await prisma.appSetting.upsert({
    where: { key: `inspiration_template_meta_${record.id}` },
    update: { value: JSON.stringify(detailPayload) },
    create: { key: `inspiration_template_meta_${record.id}`, value: JSON.stringify(detailPayload) }
  });

  return NextResponse.json({
    success: true,
    data: {
      ...record,
      tags: record.tags.map((x) => x.tag.name)
    }
  });
}
