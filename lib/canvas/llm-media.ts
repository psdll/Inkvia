import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { CANVAS_MAX_MEDIA_REFERENCES } from "./limits";
import { getLlmModelModalities } from "@/lib/llm-routing/model-modalities";
import { resolvePromptReverseMediaUrl } from "@/lib/prompt-reverse-media-url";
import { resolveAssetUrlForExternalApi } from "@/lib/external-assets";
import { resolveMediaForPlatform } from "@/lib/media-delivery/deliver";
import { kieGeminiUsesMediaUrls, llmVideoBlock, prepareLlmVideo } from "@/lib/media-delivery/llm";
import { getMediaDeliveryMode } from "@/lib/media-delivery/settings";
import { normalizeDeliveryUploadPath } from "@/lib/media-delivery/uploads";
import { resolveLocalUploadPath } from "@/lib/tool-media/media-probe";
import { safeFetch } from "@/lib/ssrf-guard";

export type CanvasLlmMediaReference = { kind: "image" | "video" | "audio"; url: string };
export class CanvasLlmInputError extends Error {}

const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
const INLINE_QWEN_AUDIO_SIZE = 7 * 1024 * 1024;

function usesQwenAudioUrl(providerId: string, modelId: string) {
  return providerId === "bailian" || /^qwen.*omni/i.test(modelId);
}

function localReferencePath(url: string, origin?: string) {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname.startsWith("/uploads/") && (url.startsWith("/") || (origin && parsed.origin === new URL(origin).origin))) {
    return normalizeDeliveryUploadPath(`http://localhost${parsed.pathname}`);
  }
  return normalizeDeliveryUploadPath(url);
}

export function normalizeCanvasLlmMedia(value: unknown, origin?: string): CanvasLlmMediaReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CanvasLlmInputError("参考素材参数无效");
  if (value.length > CANVAS_MAX_MEDIA_REFERENCES) throw new CanvasLlmInputError(`参考素材最多支持 ${CANVAS_MAX_MEDIA_REFERENCES} 个`);
  const seen = new Set<string>();
  return value.flatMap((item): CanvasLlmMediaReference[] => {
    if (!item || !["image", "video", "audio"].includes(item.kind) || typeof item.url !== "string") {
      throw new CanvasLlmInputError("参考素材参数无效");
    }
    const raw = item.url.trim();
    if (!raw) return [];
    if (raw.length > 4096) throw new CanvasLlmInputError("参考素材地址过长");
    let parsed: URL;
    try { parsed = new URL(raw, origin || "http://localhost"); } catch { throw new CanvasLlmInputError("参考素材地址无效"); }
    if ((!raw.startsWith("/uploads/") && !/^https?:\/\//i.test(raw)) || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new CanvasLlmInputError("参考素材地址无效");
    }
    const url = raw.startsWith("/uploads/") && !origin ? parsed.pathname + parsed.search : parsed.toString();
    const key = `${item.kind}:${url}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ kind: item.kind, url }];
  });
}

async function audioInput(url: string, providerId: string, modelId: string) {
  // Qwen Omni accepts an accessible URL; standard OpenAI audio input requires Base64.
  if (usesQwenAudioUrl(providerId, modelId)) return { data: url };
  const response = await safeFetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error("无法读取参考音频");
  const format = /\.(mp3|wav)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase()
    || ({ "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" } as Record<string, string>)[response.headers.get("content-type")?.split(";")[0] || ""];
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (!format) throw new CanvasLlmInputError("当前音频接口需要 MP3 或 WAV 格式，请转换素材后重试");
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_AUDIO_SIZE) throw new CanvasLlmInputError("参考音频超过 25 MB，请剪短后重试");
      chunks.push(part.value);
    }
    return { data: Buffer.concat(chunks).toString("base64"), format };
  } finally { await reader.cancel(); }
}

async function localAudioInput(url: string, file: string, providerId: string, modelId: string) {
  const qwen = usesQwenAudioUrl(providerId, modelId);
  const format = path.extname(file).slice(1).toLowerCase();
  if (qwen) {
    if (providerId === "bailian" && modelId === "qwen3.8-omni-flash"
      && ["wav", "mp3", "amr", "aac", "m4a", "ogg", "3gp", "3gpp"].includes(format)
      && (await stat(file)).size <= INLINE_QWEN_AUDIO_SIZE) {
      return { data: `data:;base64,${(await readFile(file)).toString("base64")}`, format };
    }
    return { data: await resolveAssetUrlForExternalApi(url, "canvas-llm-inputs") };
  }
  if (format !== "mp3" && format !== "wav") throw new CanvasLlmInputError("当前音频接口需要 MP3 或 WAV 格式，请转换素材后重试");
  if ((await stat(file)).size > MAX_AUDIO_SIZE) throw new CanvasLlmInputError("参考音频超过 25 MB，请剪短后重试");
  return { data: (await readFile(file)).toString("base64"), format };
}

export async function buildCanvasLlmContent(input: {
  prompt: string; providerId: string; modelId: string; mediaReferences?: CanvasLlmMediaReference[]; origin?: string;
}): Promise<unknown> {
  const references = normalizeCanvasLlmMedia(input.mediaReferences, input.origin);
  const capabilities = getLlmModelModalities(input.providerId, input.modelId);
  const labels = { image: "图片", video: "视频", audio: "音频" };
  for (const reference of references) {
    if (capabilities && !capabilities.input.includes(reference.kind)) {
      throw new CanvasLlmInputError(`${input.modelId} 不支持${labels[reference.kind]}输入，请选择支持该素材的模型`);
    }
  }
  if (!references.length) return input.prompt;
  const blocks: unknown[] = [{ type: "text", text: input.prompt }];
  const platformFirst = await getMediaDeliveryMode() === "platform";
  const kieMediaUrls = kieGeminiUsesMediaUrls(input.providerId, input.modelId);
  let inlineBudget = 56 * 1024 * 1024 - Buffer.byteLength(input.prompt);
  for (const reference of references) {
    try {
      if (reference.kind === "image") {
        const origin = input.origin || "http://localhost";
        const url = platformFirst
          ? await resolvePromptReverseMediaUrl(reference.url, origin, input.providerId, input.modelId)
          : await resolvePromptReverseMediaUrl(reference.url, origin, input.providerId);
        blocks.push({ type: "image_url", image_url: { url } });
        if (platformFirst && url.startsWith("data:")) inlineBudget -= url.length;
        continue;
      }
      const uploadPath = platformFirst ? localReferencePath(reference.url, input.origin) : "";
      if (kieMediaUrls) {
        const url = uploadPath
          ? await resolveMediaForPlatform(uploadPath, "canvas-llm-inputs", { platform: "kie" }, reference.kind)
          : await resolveAssetUrlForExternalApi(reference.url, "canvas-llm-inputs");
        blocks.push({ type: "image_url", image_url: { url } });
        continue;
      }
      const local = uploadPath ? resolveLocalUploadPath(uploadPath) : "";
      if (reference.kind === "video") {
        const source = local ? await prepareLlmVideo(local, input, { inlineBudget }) : null;
        if (source && "url" in source && source.url.startsWith("data:")) inlineBudget -= source.url.length;
        blocks.push(llmVideoBlock(source ?? { url: await resolveAssetUrlForExternalApi(reference.url, "canvas-llm-inputs") }));
        continue;
      }
      const audio = local
        ? await localAudioInput(reference.url, local, input.providerId, input.modelId)
        : await audioInput(await resolveAssetUrlForExternalApi(reference.url, "canvas-llm-inputs"), input.providerId, input.modelId);
      if (platformFirst && !/^https?:\/\//i.test(audio.data)) inlineBudget -= audio.data.length;
      blocks.push({ type: "input_audio", input_audio: audio });
    } catch (error) {
      if (error instanceof CanvasLlmInputError) throw error;
      if (error instanceof Error && error.name === "MissingExternalAssetStorageError") {
        throw new CanvasLlmInputError(error.message);
      }
      throw new CanvasLlmInputError(`参考${labels[reference.kind]}无法读取或转存，请检查素材格式和存储服务后重试`);
    }
  }
  return blocks;
}
