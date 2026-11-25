import "server-only";

import { openAsBlob } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { FormData } from "undici";
import { safeFetch } from "@/lib/ssrf-guard";
import { getSeedanceMediaPolicy } from "@/lib/seedance-media-policy";
import { resolveLocalUploadPath } from "@/lib/tool-media/media-probe";
import { fetchWithProviderEgress, resolveProviderRequestContext } from "@/lib/providers/transport";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import type { MediaKind } from "./catalog";

export type DeliveryFile = { blob: Blob; name: string; mime: string };

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/mp4",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac",
};

export function normalizeDeliveryUploadPath(raw: string, allowLan = true): string {
  const value = String(raw || "").trim().replaceAll("\\", "/");
  if (value.startsWith("/uploads/")) return value;
  if (value.startsWith("uploads/")) return `/${value}`;
  if (!/^https?:\/\//i.test(value)) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local");
    const lan = allowLan && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
    if ((!local && !lan) || !url.pathname.startsWith("/uploads/")) return "";
    if (!allowLan) return url.pathname;
    if (/%(?:2f|5c)/i.test(url.pathname)) return "";
    return decodeURIComponent(url.pathname);
  } catch {
    return "";
  }
}

export async function readDeliveryFile(uploadPath: string): Promise<DeliveryFile> {
  const absolute = resolveLocalUploadPath(uploadPath);
  const ext = path.extname(absolute).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";
  const blob = await openAsBlob(absolute, { type: mime });
  return { blob, mime, name: `${randomUUID()}${ext || ".bin"}` };
}

export async function deliveryProviderContext(platform: string) {
  const context = await resolveProviderRequestContext(platform);
  return { context, apiKey: resolvedProviderApiKey(context.provider) };
}

export async function readUploadJson(response: Response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`上传接口返回了无法解析的内容（HTTP ${response.status}）`);
  }
}

export function uploadHttpUrl(raw: unknown) {
  try {
    const url = new URL(String(raw || "").trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function multipart(file: DeliveryFile) {
  const form = new FormData();
  form.append("file", file.blob, file.name);
  return form;
}

export async function uploadToKie(file: DeliveryFile, kind: MediaKind) {
  const { context, apiKey } = await deliveryProviderContext("kie");
  const form = multipart(file);
  form.append("uploadPath", `inkvia/${kind}`);
  form.append("fileName", file.name);
  const response = await fetchWithProviderEgress(context.decision, "https://kieai.redpandaai.co/api/file-stream-upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const data = await readUploadJson(response);
  const url = uploadHttpUrl(data?.data?.downloadUrl);
  if (!response.ok || Number(data?.code) !== 200 || !url) {
    throw new Error(`KIE 文件上传失败（HTTP ${response.status}）`);
  }
  return url;
}

const APIMART_UPLOADS = {
  image: { path: "images", mb: 30, types: ["image/jpeg", "image/png", "image/gif", "image/webp"], formats: "JPEG、PNG、GIF、WebP" },
  video: { path: "videos", mb: 50, types: ["video/mp4", "video/quicktime", "video/webm"], formats: "MP4、MOV、WebM" },
  audio: { path: "audios", mb: 15, types: ["audio/mpeg", "audio/wav", "audio/mp4"], formats: "MP3、WAV、M4A" },
} as const;

export async function uploadToApimart(file: DeliveryFile, kind: MediaKind) {
  const rule = APIMART_UPLOADS[kind];
  if (!(rule.types as readonly string[]).includes(file.mime)) throw new Error(`APIMart ${rule.path} 仅支持 ${rule.formats}`);
  if (file.blob.size > rule.mb * 1024 * 1024) throw new Error(`文件超过 APIMart ${rule.mb} MB 上传上限`);
  const { context, apiKey } = await deliveryProviderContext("apimart");
  const base = String(context.provider.baseUrl || "https://api.apimart.ai/v1").replace(/\/+$/, "");
  const response = await fetchWithProviderEgress(context.decision, `${base}/uploads/${rule.path}?retention_days=3`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: multipart(file),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await readUploadJson(response);
  const url = uploadHttpUrl(data?.url);
  if (!response.ok || !url) {
    const reason = response.status === 402 ? "，请检查余额或免费额度"
      : response.status === 429 ? "，上传次数或频率达到限制" : "";
    throw new Error(`APIMart 文件上传失败（HTTP ${response.status}${reason}）`);
  }
  return url;
}

export async function uploadToArkVideoLink(file: DeliveryFile, model: string) {
  const policy = getSeedanceMediaPolicy(model);
  const extension = path.extname(file.name).slice(1).toLowerCase();
  if (!policy?.allowedKinds.includes("video") || !policy.video.extensions.includes(extension)) {
    throw new Error("方舟参考视频上传仅适用于 Seedance 支持的 MP4、MOV 视频");
  }
  if (file.blob.size > policy.video.maxBytes) throw new Error("参考视频超过 Seedance 文件大小上限");

  const { context, apiKey } = await deliveryProviderContext("volcengine");
  const base = context.provider.baseUrl.trim().replace(/\/+$/, "").replace(/\/api\/v3$/, "");
  const endpoint = `${base}/api/v3/files`;
  const headers = { Authorization: `Bearer ${apiKey}` };
  const form = multipart(file);
  form.append("purpose", "agent");
  const signal = AbortSignal.timeout(120_000);
  const response = await fetchWithProviderEgress(context.decision, endpoint, { method: "POST", headers, body: form, signal });
  if (!response.ok) throw new Error(`方舟参考视频上传失败（HTTP ${response.status}）`);
  let data = await readUploadJson(response) as { id?: string; status?: string; download_url?: string } | null;
  const id = data?.id;
  if (typeof id !== "string" || !id.startsWith("file-")) throw new Error("方舟参考视频上传未返回文件 ID");
  while (data?.status === "processing") {
    await delay(1000, undefined, { signal });
    const check = await fetchWithProviderEgress(context.decision, `${endpoint}/${encodeURIComponent(id)}`, { headers, signal });
    if (!check.ok) throw new Error(`查询方舟文件状态失败（HTTP ${check.status}）`);
    data = await readUploadJson(check);
  }
  const url = uploadHttpUrl(data?.download_url);
  if (data?.status !== "active" || !url) throw new Error("方舟未返回可用的参考视频下载链接");

  // Verify the signed GET works without the Ark API Key before submitting a generation.
  const probe = await safeFetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(10_000) });
  await probe.body?.cancel().catch(() => undefined);
  const mime = probe.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  if (!probe.ok || probe.status === 204 || (mime && mime !== "application/octet-stream" && !mime.startsWith("video/"))) {
    throw new Error(`方舟参考视频链接无法读取（HTTP ${probe.status}）`);
  }
  return url;
}

export async function uploadToMiniMaxVideo(file: DeliveryFile, kind: "video" | "audio") {
  const rule = kind === "video"
    ? { mb: 50, mimes: ["video/mp4", "video/quicktime"], formats: "MP4、MOV" }
    : { mb: 15, mimes: ["audio/mpeg", "audio/wav"], formats: "MP3、WAV" };
  if (!rule.mimes.includes(file.mime)) throw new Error(`MiniMax 文件上传仅支持 ${rule.formats}`);
  if (file.blob.size > rule.mb * 1024 * 1024) throw new Error(`文件超过 MiniMax ${rule.mb} MB 上传上限`);
  return uploadMiniMaxFile(file, "video_generation_input");
}

export async function uploadMiniMaxFile(
  file: DeliveryFile,
  purpose: "video_generation_input" | "video_understanding",
  signal?: AbortSignal,
) {
  const { context, apiKey } = await deliveryProviderContext("minimax");
  const base = context.provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const form = multipart(file);
  form.append("purpose", purpose);
  const response = await fetchWithProviderEgress(context.decision, `${base}/v1/files/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  // MiniMax returns int64 identifiers that can exceed Number.MAX_SAFE_INTEGER.
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body.replace(/("file_id"\s*:\s*)(\d+)(?=[,}\s])/g, '$1"$2"'));
  } catch {
    throw new Error(`MiniMax 文件上传返回无法解析的内容（HTTP ${response.status}）`);
  }
  const fileId = String(data?.file?.file_id || "").trim();
  if (!response.ok || Number(data?.base_resp?.status_code ?? 0) !== 0 || !/^\d+$/.test(fileId)) {
    throw new Error(`MiniMax 文件上传失败（HTTP ${response.status}）`);
  }
  return `mm_file://${fileId}`;
}
