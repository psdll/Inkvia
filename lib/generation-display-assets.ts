import fs from "fs-extra";
import { resolvePublicPath } from "@/lib/public-path";
import { safeFetch } from "@/lib/ssrf-guard";
import { normalizeMediaUrl, isVideoMediaUrl, isAudioMediaUrl } from "@/lib/media-url";
import {
  createMediaLibraryGridThumbnail,
  createMediaLibraryImagePreview,
  createMediaLibraryVideoPoster,
} from "@/lib/media-library-thumbnails";
import {
  GENERATION_POSTERS_FOLDER,
  GENERATION_PREVIEWS_FOLDER,
} from "@/lib/upload-buckets";

export type GenerationDisplayFields = {
  displayUrl: string;
  previewUrl: string | null;
  posterUrl: string | null;
  thumbUrl: string | null;
  displayKind: "image" | "video" | "audio";
};

type GenerationDisplayInput = {
  type?: string | null;
  localPath?: string | null;
  templateData?: string | Record<string, any> | null;
};

function parseTemplateData(raw: string | Record<string, any> | null | undefined) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, any>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function mergeGenerationTemplateData(raw: string | null | undefined, patch: Record<string, any>) {
  const base = parseTemplateData(raw) || {};
  return JSON.stringify({ ...base, ...patch });
}

function isVideoGeneration(type: unknown, url: unknown) {
  const t = String(type || "").toLowerCase();
  return t === "video_gen" || t === "video_generate" || isVideoMediaUrl(url);
}

function pickDisplayUrl(meta: Record<string, any> | null) {
  return normalizeMediaUrl(
    meta?.outputDisplayUrl ||
      meta?.outputPreviewUrl ||
      meta?.outputPosterUrl ||
      meta?.displayUrl ||
      ""
  );
}

export function getGenerationDisplayFields(input: GenerationDisplayInput): GenerationDisplayFields {
  const meta = parseTemplateData(input.templateData);
  const localPath = normalizeMediaUrl(input.localPath || "");
  if (input.type === "audio_gen" || isAudioMediaUrl(localPath)) {
    return { displayKind: "audio", displayUrl: localPath, previewUrl: null, posterUrl: null, thumbUrl: null };
  }
  if (/\.gif(?:[?#]|$)/i.test(localPath)) {
    return { displayKind: "image", displayUrl: localPath, previewUrl: localPath, posterUrl: null, thumbUrl: localPath };
  }
  const displayUrl = pickDisplayUrl(meta) || localPath;
  const posterUrl = normalizeMediaUrl(meta?.outputPosterUrl || "");
  const previewUrl = normalizeMediaUrl(meta?.outputPreviewUrl || "");
  const thumbUrl = normalizeMediaUrl(meta?.outputThumbUrl || "");
  return {
    displayUrl,
    previewUrl: previewUrl || (posterUrl ? null : displayUrl || null),
    posterUrl: posterUrl || null,
    // 网格优先用 600 缩略图；没有(存量数据)则回退到 preview/poster/原图，由网格再走 /api/thumb 缩小
    thumbUrl: thumbUrl || previewUrl || posterUrl || displayUrl || null,
    displayKind: isVideoGeneration(input.type, localPath) ? "video" : "image",
  };
}

async function readMediaBuffer(raw: string) {
  const value = normalizeMediaUrl(raw);
  if (!value) return null;

  if (value.startsWith("/uploads/")) {
    const localPath = resolvePublicPath(value.replace(/^\/+/, "").split("?")[0].split("#")[0]);
    if (!(await fs.pathExists(localPath))) return null;
    return fs.readFile(localPath);
  }

  if (!/^https?:\/\//i.test(value)) return null;
  const res = await safeFetch(value, {
    method: "GET",
    headers: {
      accept: "*/*",
      "user-agent": "Mozilla/5.0",
    },
    cache: "force-cache",
  });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function createGenerationDisplayAssetPatch(input: GenerationDisplayInput) {
  const source = normalizeMediaUrl(input.localPath || "");
  if (!source) return {};
  if (input.type === "audio_gen" || isAudioMediaUrl(source)) return {};
  if (/\.gif(?:[?#]|$)/i.test(source)) return {
    outputDisplayUrl: source, outputPreviewUrl: source, outputThumbUrl: source,
    outputOriginalUrl: source, outputDisplayKind: "image",
  };
  const buffer = await readMediaBuffer(source);
  if (!buffer?.length) return {};

  if (isVideoGeneration(input.type, source)) {
    const posterUrl = await createMediaLibraryVideoPoster(buffer, {
      contentType: "video/mp4",
      folder: GENERATION_POSTERS_FOLDER,
      kind: "video",
      sourceName: `generation-poster-${Date.now()}.webp`,
    });
    if (!posterUrl) return {};
    // 网格 600 缩略图：从 poster(图片)再缩一档，图墙首次打开即小图
    let thumbUrl = posterUrl;
    const posterBuffer = await readMediaBuffer(posterUrl);
    if (posterBuffer?.length) {
      thumbUrl =
        (await createMediaLibraryGridThumbnail(posterBuffer, {
          contentType: "image/webp",
          folder: GENERATION_POSTERS_FOLDER,
          kind: "image",
          sourceName: `generation-thumb-${Date.now()}.webp`,
        })) || posterUrl;
    }
    return {
      outputDisplayUrl: posterUrl,
      outputPosterUrl: posterUrl,
      outputThumbUrl: thumbUrl,
      outputOriginalUrl: source,
      outputDisplayKind: "video",
    };
  }

  const [previewUrl, generatedThumbUrl] = await Promise.all([
    createMediaLibraryImagePreview(buffer, {
      contentType: "image/png",
      folder: GENERATION_PREVIEWS_FOLDER,
      kind: "image",
      sourceName: `generation-preview-${Date.now()}.webp`,
    }),
    createMediaLibraryGridThumbnail(buffer, {
      contentType: "image/png",
      folder: GENERATION_PREVIEWS_FOLDER,
      kind: "image",
      sourceName: `generation-thumb-${Date.now()}.webp`,
    }),
  ]);
  if (!previewUrl) return {};
  // 网格 600 缩略图：与 1280 预览同源不同尺寸，图墙首次打开即小图（详情仍用 1280/原图，不受影响）
  const thumbUrl = generatedThumbUrl || previewUrl;
  return {
    outputDisplayUrl: previewUrl,
    outputPreviewUrl: previewUrl,
    outputThumbUrl: thumbUrl,
    outputOriginalUrl: source,
    outputDisplayKind: "image",
  };
}
