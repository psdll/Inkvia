import "server-only";

import { FormData } from "undici";
import { providerErrorSensitiveValues, sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { fetchWithProviderEgress, resolveProviderRequestContext } from "@/lib/providers/transport";
import { WORK_FISHER_PROVIDER_ID } from "@/lib/work-fisher-image-params";

// https://api.work-fisher.com/docs/#upload
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp",
  "audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac",
  "video/mp4", "video/x-msvideo", "video/quicktime", "video/x-matroska",
]);

export async function uploadToFisher(file: { blob: Blob; name: string; mime: string }): Promise<string> {
  if (!SUPPORTED_MIME_TYPES.has(file.mime)) {
    throw new Error("FisherAI 上传格式仅支持 JPG、PNG、WebP、MP3、WAV、FLAC、MP4、AVI、MOV、MKV");
  }
  if (file.blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("FisherAI 单个上传文件不能超过 50 MB");
  }

  const { provider, decision } = await resolveProviderRequestContext(WORK_FISHER_PROVIDER_ID);
  const apiKey = resolvedProviderApiKey(provider);
  const base = provider.baseUrl.trim().replace(/\/+$/, "");
  const endpoint = `${base}/files/upload`;
  const form = new FormData();
  form.append("file", file.blob, file.name);
  const response = await fetchWithProviderEgress(decision, endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const sensitive = providerErrorSensitiveValues(decision, apiKey, base, endpoint);
    const message = sanitizeProviderErrorText(data?.error?.message || data?.message, sensitive, "上传请求失败");
    throw new Error(`FisherAI 文件上传失败（HTTP ${response.status}）：${message}`);
  }
  const url = typeof data?.url === "string" ? data.url.trim() : "";
  if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) {
    throw new Error("FisherAI 上传接口没有返回可用的素材链接");
  }
  return url;
}
