import "server-only";

import { FormData } from "undici";
import { resolveAssetUrlForExternalApi } from "@/lib/external-assets";
import { fetchWithProviderEgress } from "@/lib/providers/transport";
import { sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import { inferMediaKind, platformDeliveryMethod, type MediaKind } from "./catalog";
import { uploadToFisher } from "./fisher-upload";
import { getMediaDeliveryMode } from "./settings";
import {
  deliveryProviderContext,
  normalizeDeliveryUploadPath,
  readDeliveryFile,
  readUploadJson,
  uploadToApimart,
  uploadToArkVideoLink,
  uploadToKie,
  uploadToMiniMaxVideo,
  type DeliveryFile,
} from "./uploads";

export type MediaDeliveryTarget = {
  platform: string;
  /** Upstream model name; Bailian binds temporary files to the model that will read them. */
  model?: string;
};

/** Bailian's console workspace domain also serves the upload policy endpoint. */
export function bailianApiOrigin(baseUrl: string) {
  try {
    const url = new URL(String(baseUrl || "").trim());
    if (url.protocol === "https:") return url.origin;
  } catch {}
  return "https://dashscope.aliyuncs.com";
}

async function uploadToBailian(file: DeliveryFile, model: string) {
  if (!model) throw new Error("百炼临时存储需要指定调用的模型");
  const { context, apiKey } = await deliveryProviderContext("bailian");
  const origin = bailianApiOrigin(context.provider.baseUrl);
  const policyResponse = await fetchWithProviderEgress(
    context.decision,
    `${origin}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
    { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000) },
  );
  const policyBody = await readUploadJson(policyResponse);
  const policy = policyBody?.data;
  if (!policyResponse.ok || !policy?.upload_host || !policy?.upload_dir) {
    throw new Error(`百炼临时存储凭证获取失败：${String(policyBody?.message || policyResponse.status).slice(0, 160)}`);
  }
  const maxFileMb = Number(policy.max_file_size_mb);
  if (maxFileMb > 0 && file.blob.size > maxFileMb * 1024 * 1024) {
    throw new Error(`文件超过该百炼模型的 ${maxFileMb} MB 临时上传上限`);
  }
  const key = `${policy.upload_dir}/${file.name}`;
  const form = new FormData();
  form.append("OSSAccessKeyId", String(policy.oss_access_key_id));
  form.append("Signature", String(policy.signature));
  form.append("policy", String(policy.policy));
  form.append("x-oss-object-acl", String(policy.x_oss_object_acl));
  form.append("x-oss-forbid-overwrite", String(policy.x_oss_forbid_overwrite));
  form.append("key", key);
  form.append("success_action_status", "200");
  form.append("file", file.blob, file.name);
  const upload = await fetchWithProviderEgress(context.decision, String(policy.upload_host), {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!upload.ok) {
    const text = await upload.text().catch(() => "");
    throw new Error(`百炼临时存储上传失败（HTTP ${upload.status}）${text.slice(0, 120)}`);
  }
  return `oss://${key}`;
}

const INLINE_IMAGE_MIMES: Record<string, string[]> = {
  openrouter: ["image/png", "image/jpeg", "image/webp"],
  volcengine: ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/tiff", "image/gif"],
  minimax: ["image/png", "image/jpeg", "image/webp"],
};
const INLINE_LIMIT_MB: Record<string, number> = { volcengine: 10, minimax: 20, openrouter: 20, bigmodel: 5 };
const AUDIO_DATA_MIME: Record<string, string> = { "audio/mpeg": "audio/mp3", "audio/wav": "audio/wav" };

async function inlineBase64(file: DeliveryFile, platform: string, kind: MediaKind, limit = INLINE_LIMIT_MB[platform] ?? 10) {
  const allowed = kind === "image" ? INLINE_IMAGE_MIMES[platform] : undefined;
  const dataMime = kind === "audio" && (platform === "volcengine" || platform === "minimax") ? AUDIO_DATA_MIME[file.mime] : file.mime;
  if ((allowed && !allowed.includes(file.mime)) || !dataMime) throw new Error(`${file.mime} 不支持以 Base64 发送`);
  if (file.blob.size > limit * 1024 * 1024) throw new Error(`文件超过 Base64 上限 ${limit} MB`);
  return `data:${dataMime};base64,${Buffer.from(await file.blob.arrayBuffer()).toString("base64")}`;
}

type NativeMediaDelivery = { url: string; via: "platform-upload" | "inline-base64" };
export type MediaDeliveryResult = { url: string; via: NativeMediaDelivery["via"] | "oss" | "unchanged" };

async function deliverMiniMaxMedia(file: DeliveryFile, kind: "video" | "audio"): Promise<NativeMediaDelivery> {
  const canInline = kind === "video" ? file.mime === "video/mp4" : Boolean(AUDIO_DATA_MIME[file.mime]);
  // The request budget is shared across all references. Large files get an internal ID.
  const inlineLimit = 5;
  if (canInline && file.blob.size <= inlineLimit * 1024 * 1024) {
    return { url: await inlineBase64(file, "minimax", kind, inlineLimit), via: "inline-base64" };
  }
  return { url: await uploadToMiniMaxVideo(file, kind), via: "platform-upload" };
}

async function deliverNativeMedia(file: DeliveryFile, kind: MediaKind, target: MediaDeliveryTarget): Promise<NativeMediaDelivery | null> {
  const { platform, model } = target;
  const method = platformDeliveryMethod(platform, kind);
  if (method === "inline-base64") {
    const limit = platform === "volcengine" && kind === "audio" ? 15 : undefined;
    return { url: await inlineBase64(file, platform, kind, limit), via: "inline-base64" };
  }
  if (method !== "platform-upload") return null;
  switch (platform) {
    case "kie": return { url: await uploadToKie(file, kind), via: "platform-upload" };
    case "apimart": return { url: await uploadToApimart(file, kind), via: "platform-upload" };
    case "volcengine": return kind === "video" && model ? { url: await uploadToArkVideoLink(file, model), via: "platform-upload" } : null;
    case "bailian": return { url: await uploadToBailian(file, String(model || "")), via: "platform-upload" };
    case "work-fisher": return { url: await uploadToFisher(file), via: "platform-upload" };
    case "minimax": return kind === "image" ? null : deliverMiniMaxMedia(file, kind);
    default: return null;
  }
}

export async function deliverMediaForPlatform(
  raw: string,
  folder: string,
  target?: MediaDeliveryTarget | null,
  kindHint?: MediaKind,
): Promise<MediaDeliveryResult> {
  const value = String(raw || "").trim();
  const uploadPath = normalizeDeliveryUploadPath(value, false);
  if (!uploadPath || !target?.platform || (await getMediaDeliveryMode()) !== "platform") {
    const url = await resolveAssetUrlForExternalApi(value, folder);
    return { url, via: uploadPath ? "oss" : "unchanged" };
  }

  const kind = kindHint || inferMediaKind(uploadPath);
  const method = platformDeliveryMethod(target.platform, kind);
  if (method === "local-inline") return { url: uploadPath, via: "unchanged" };
  if (method !== "oss") {
    try {
      const native = await deliverNativeMedia(await readDeliveryFile(uploadPath), kind, target);
      if (native) return native;
    } catch (error) {
      console.warn(`[media-delivery] ${target.platform} ${kind} 平台方式失败，尝试阿里云 OSS：${sanitizeProviderErrorText(error instanceof Error ? error.message : error)}`);
    }
  }
  return { url: await resolveAssetUrlForExternalApi(value, folder), via: "oss" };
}

export async function resolveMediaForPlatform(raw: string, folder: string, target?: MediaDeliveryTarget | null, kindHint?: MediaKind) {
  return (await deliverMediaForPlatform(raw, folder, target, kindHint)).url;
}

/** The platform's adapter reads the local file itself, in every delivery mode; no relay or public URL needed. */
export function platformReadsLocalFile(target: MediaDeliveryTarget | null | undefined, kind: MediaKind) {
  return Boolean(target?.platform) && platformDeliveryMethod(target!.platform, kind) === "local-inline";
}

/** Whether a local file of this kind skips the OSS relay for the target under the current switch. */
export async function platformHandlesMedia(target: MediaDeliveryTarget | null | undefined, kind: MediaKind) {
  if (!target?.platform || (await getMediaDeliveryMode()) !== "platform") return false;
  const method = platformDeliveryMethod(target.platform, kind);
  return method === "platform-upload" || method === "inline-base64";
}

/** Shortens data URLs before they reach logs or stored metadata. */
export function redactInlineMedia(value: string) {
  return /^data:/i.test(value) ? `${value.slice(0, value.indexOf(",") + 1)}…(${value.length} chars)` : value;
}
