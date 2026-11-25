import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizeMediaUrl } from "@/lib/media-url";

function asObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

function parseJsonText(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((x) => normalizeMediaUrl(x)).filter(Boolean);
}

function inferTemplateType(toolType: string) {
  if (toolType === "face") return "face_swap";
  if (toolType === "video") return "video_generate";
  return "image_edit";
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ success: false, error: apiMessage("m37b0cea26f1a") }, { status: 404 });

  const template = await prisma.template.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } }
  });
  if (!template) return NextResponse.json({ success: false, error: apiMessage("m37b0cea26f1a") }, { status: 404 });

  const setting = await prisma.appSetting
    .findUnique({ where: { key: `inspiration_template_meta_${id}` } })
    .catch(() => null);
  const meta = parseJsonText(setting?.value);
  const paramsObj = asObject(meta?.params) || {};
  const inputPaths = toStringArray(meta?.inputPaths);
  const outputPaths = toStringArray(meta?.outputPaths);
  const preview = normalizeMediaUrl(template.mediaType === "video" ? template.previewVideoPath : template.previewImagePath);

  const finalOutputs = outputPaths.length ? outputPaths : preview ? [preview] : [];
  const finalInputs = inputPaths;

  return NextResponse.json({
    success: true,
    data: {
      id: template.id,
      title: template.title,
      prompt: template.prompt,
      description: template.description,
      toolType: template.toolType,
      mediaType: template.mediaType,
      previewImagePath: normalizeMediaUrl(template.previewImagePath),
      previewVideoPath: normalizeMediaUrl(template.previewVideoPath),
      tags: template.tags.map((x) => x.tag.name),
      createdAt: template.createdAt,
      detail: {
        type: inferTemplateType(template.toolType),
        model: String(meta?.model || paramsObj.model || "").trim() || null,
        params: paramsObj,
        inputImages: finalInputs,
        outputPaths: finalOutputs
      }
    }
  });
}
