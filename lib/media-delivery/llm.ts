import "server-only";

import fs from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FormData } from "undici";
import { isMiniMaxLlmModel } from "@/lib/minimax-llm-models";
import { fetchWithProviderEgress, resolveProviderRequestContext } from "@/lib/providers/transport";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { resolveVolcengineLlmBaseUrl } from "@/lib/volcengine-llm-models";
import { uploadMiniMaxFile } from "./uploads";

const MiB = 1024 * 1024;
const VIDEO_MIMES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
};

export type LlmVideoSource = { url: string; fps?: number } | { file_id: string };
type LlmVideoTarget = { providerId: string; modelId: string };

/** Older and current KIE Gemini OpenAI paths use image_url for every media type. */
export function kieGeminiUsesMediaUrls(providerId?: string, modelId?: string) {
  return providerId === "kie" && /^(?:gemini-2\.5-pro|gemini-3(?:\.1)?-pro|gemini-3-[5-8]-flash-openai|gemini-4-(?:argon|hydrogen|carbon|neon)-openai)$/.test(modelId || "");
}

export function llmVideoBlock(source: LlmVideoSource) {
  return { type: "video_url", video_url: source };
}

async function uploadArkVideo(file: string, mime: string, model: string, fps: number, signal: AbortSignal) {
  const { provider, decision } = await resolveProviderRequestContext("volcengine");
  const filesUrl = `${resolveVolcengineLlmBaseUrl(provider.baseUrl)}/files`;
  const headers = { Authorization: `Bearer ${resolvedProviderApiKey(provider)}` };
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", await fs.openAsBlob(file, { type: mime }), path.basename(file));
  form.append("preprocess_configs[video][model]", model);
  form.append("preprocess_configs[video][fps]", String(fps));
  const uploaded = await fetchWithProviderEgress(decision, filesUrl, { method: "POST", headers, body: form, signal });
  if (!uploaded.ok) throw new Error(`方舟视频上传失败（HTTP ${uploaded.status}）`);
  let data = await uploaded.json() as { id?: string; status?: string };
  const id = data.id;
  if (typeof id !== "string" || !id.startsWith("file-")) throw new Error("方舟视频上传未返回文件 ID");
  while (data.status === "processing") {
    await delay(1000, undefined, { signal });
    const check = await fetchWithProviderEgress(decision, `${filesUrl}/${encodeURIComponent(id)}`, { headers, signal });
    if (!check.ok) throw new Error(`查询方舟文件状态失败（HTTP ${check.status}）`);
    data = await check.json() as typeof data;
  }
  if (data.status !== "active") throw new Error("方舟视频预处理失败");
  return { file_id: id };
}

/** Returns null when the target needs a public URL, or when its own upload fails. */
export async function prepareLlmVideo(
  file: string,
  target: LlmVideoTarget,
  options: { fps?: number; signal?: AbortSignal; inlineBudget?: number } = {},
): Promise<LlmVideoSource | null> {
  const ext = path.extname(file).toLowerCase();
  const mime = VIDEO_MIMES[ext];
  if (!mime) return null;
  const ark = target.providerId === "volcengine" && [".mp4", ".avi", ".mov"].includes(ext);
  const bailian = target.providerId === "bailian" && /^qwen3\.8-(?:max|flash|27b|omni-flash)$/.test(target.modelId);
  const openrouter = target.providerId === "openrouter";
  const minimax = isMiniMaxLlmModel(target.providerId, target.modelId) && [".mp4", ".avi", ".mov", ".mkv"].includes(ext);
  if (!ark && !bailian && !openrouter && !minimax) return null;

  const { size } = await stat(file);
  const inlineBudget = options.inlineBudget ?? 56 * MiB;
  const canInline = Math.ceil(size / 3) * 4 + 64 <= inlineBudget;
  const fps = options.fps;
  options.signal?.throwIfAborted();
  if (canInline && ((ark && size <= 10 * MiB) || (bailian && ext === ".mp4" && size <= 7 * MiB) || (openrouter && ext === ".mp4" && size <= 20 * MiB))) {
    const encodingMime = bailian && target.modelId === "qwen3.8-omni-flash" ? "" : mime;
    const data = (await readFile(file, { signal: options.signal })).toString("base64");
    return { url: `data:${encodingMime};base64,${data}`, ...(ark && fps !== undefined ? { fps } : {}) };
  }

  if ((ark || minimax) && size <= 512 * MiB) {
    const timeout = AbortSignal.timeout(120_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      if (ark) return await uploadArkVideo(file, mime, target.modelId, fps ?? 1, signal);
      const blob = await fs.openAsBlob(file, { type: mime });
      const url = await uploadMiniMaxFile({ blob, mime, name: path.basename(file) }, "video_understanding", signal);
      signal.throwIfAborted();
      return { url };
    } catch {
      options.signal?.throwIfAborted();
    }
  }
  // Ark's small-file recommendation can be exceeded within the documented request budget.
  if (ark && canInline && size < 50_000_000) {
    const data = (await readFile(file, { signal: options.signal })).toString("base64");
    return { url: `data:${mime};base64,${data}`, ...(fps === undefined ? {} : { fps }) };
  }
  return null;
}
