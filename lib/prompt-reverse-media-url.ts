import fs from "node:fs/promises";
import { resolveAssetUrlForExternalApi } from "@/lib/external-assets";
import { isOssReady, uploadBufferToOss } from "@/lib/oss";
import { preparePromptReverseRelayImage } from "@/lib/prompt-reverse-media";
import { resolvePublicPath } from "@/lib/public-path";
import { LLM_INLINE_IMAGE_PLATFORMS } from "@/lib/media-delivery/catalog";
import { resolveMediaForPlatform } from "@/lib/media-delivery/deliver";
import { kieGeminiUsesMediaUrls } from "@/lib/media-delivery/llm";
import { getMediaDeliveryMode } from "@/lib/media-delivery/settings";

function localUploadPathFromUrl(raw: string) {
  const value = String(raw || "").trim().replaceAll("\\", "/");
  try {
    const parsed = new URL(value.startsWith("uploads/") ? `/${value}` : value, "http://localhost");
    if (!parsed.pathname.startsWith("/uploads/")) return "";
    // URL.pathname stays percent-encoded, whereas the filesystem uses the decoded name.
    // Decode exactly once and reject encoded separators/traversal before reading a file.
    if (/%2f|%5c/i.test(parsed.pathname)) throw new Error("INVALID_UPLOAD_PATH");
    const decoded = decodeURIComponent(parsed.pathname);
    if (decoded.includes("\0") || decoded.split("/").some(part => part === "." || part === "..")) {
      throw new Error("INVALID_UPLOAD_PATH");
    }
    return decoded;
  } catch {}
  return "";
}

export function llmAcceptsInlineImage(providerId?: string, modelId?: string) {
  if (!providerId) return false;
  if (LLM_INLINE_IMAGE_PLATFORMS.includes(providerId)) return true;
  return providerId === "deepseek"
    && ["deepseek-flash", "deepseek-v4.1-flash", "deepseek-v4-flash-vision-exp"].includes(modelId || "");
}

export async function resolvePromptReverseMediaUrl(
  mediaUrl: string,
  origin: string,
  /** LLM platform reading the image; chat platforms that take Base64 skip the OSS relay. */
  providerId?: string,
  modelId?: string,
  folder = "prompt-reverse-inputs",
) {
  const localPath = localUploadPathFromUrl(mediaUrl);
  const kieMediaUrls = kieGeminiUsesMediaUrls(providerId, modelId);
  if (localPath && (kieMediaUrls || llmAcceptsInlineImage(providerId, modelId)) && await getMediaDeliveryMode() === "platform") {
    if (kieMediaUrls) return resolveMediaForPlatform(localPath, folder, { platform: "kie" }, "image");
    const input = await fs.readFile(resolvePublicPath(localPath.replace(/^\/+/, "")));
    const relayImage = await preparePromptReverseRelayImage(input);
    return `data:image/jpeg;base64,${relayImage.toString("base64")}`;
  }
  if (localPath && await isOssReady()) {
    const input = await fs.readFile(resolvePublicPath(localPath.replace(/^\/+/, "")));
    const relayImage = await preparePromptReverseRelayImage(input);
    return uploadBufferToOss(
      relayImage,
      folder,
      `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
      "image/jpeg",
    );
  }
  return resolveAssetUrlForExternalApi(
    mediaUrl.startsWith("/") ? new URL(mediaUrl, origin).toString() : mediaUrl,
    folder,
  );
}

