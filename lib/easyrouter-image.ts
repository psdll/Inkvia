import fs from "fs-extra";
import path from "path";
import sharp from "sharp";
import type { RequestInit as UndiciRequestInit } from "undici";
import { mapEasyRouterGptImage2Size } from "@/lib/easyrouter-image-params";
import { resolvePublicPath } from "@/lib/public-path";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import { fetchWithProviderEgress, resolveProviderRequestContext, type ProviderEgressDecision } from "@/lib/providers/transport";

export { mapEasyRouterGptImage2Size } from "@/lib/easyrouter-image-params";

export const EASYROUTER_IMAGE_MODEL_ID = "image 2";
export const EASYROUTER_GPT_IMAGE_2_MODEL_ID = "gpt-image-2";

type EasyRouterImageInput = {
  model: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  customSize?: string;
  quality?: string;
  imageUrls?: string[];
};

type EasyRouterImageResult = {
  images: string[];
  raw: unknown;
};

type EasyRouterImageRequestInput = Pick<EasyRouterImageInput, "prompt" | "aspectRatio" | "resolution" | "customSize" | "quality">;

function clean(value: unknown) {
  return String(value || "").trim();
}

function trimSlash(value: string) {
  return clean(value).replace(/\/+$/, "");
}

function normalizeQuality(value: unknown) {
  const quality = clean(value).toLowerCase();
  return quality === "low" || quality === "high" ? quality : "medium";
}

export function isEasyRouterImageModel(model: string) {
  return clean(model) === EASYROUTER_IMAGE_MODEL_ID;
}

export function buildEasyRouterImageRequest(input: EasyRouterImageRequestInput) {
  return {
    endpoint: "/images/generations",
    body: {
      model: EASYROUTER_GPT_IMAGE_2_MODEL_ID,
      prompt: clean(input.prompt),
      quality: normalizeQuality(input.quality),
      size: mapEasyRouterGptImage2Size(input),
      output_format: "png",
    },
  };
}

export function buildEasyRouterImageEditRequest(input: EasyRouterImageRequestInput & { images: Blob[] }) {
  const body = new FormData();
  body.set("model", EASYROUTER_GPT_IMAGE_2_MODEL_ID);
  body.set("prompt", clean(input.prompt));
  body.set("quality", normalizeQuality(input.quality));
  body.set("size", mapEasyRouterGptImage2Size(input));
  body.set("output_format", "png");
  if (input.images.length === 1) {
    body.set("image", input.images[0], "image.png");
  } else {
    input.images.forEach((image, index) => {
      body.append("image[]", image, `image-${index + 1}.png`);
    });
  }
  return { endpoint: "/images/edits", body };
}

export function extractEasyRouterImageUrls(data: any) {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(data?.data) ? data.data : []) {
    const url = clean(item?.url);
    const base64 = clean(item?.b64_json);
    const result = url || (base64 ? `data:image/png;base64,${base64}` : "");
    if (result && !seen.has(result)) {
      seen.add(result);
      urls.push(result);
    }
  }
  return urls;
}

function getUploadsRootDir() {
  const configured = clean(process.env.UPLOADS_DIR);
  return configured ? path.resolve(configured) : resolvePublicPath("uploads");
}

function resolveLocalUploadFile(uploadPath: string) {
  const normalized = clean(uploadPath).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized.startsWith("uploads/")) return "";
  return path.join(getUploadsRootDir(), normalized.slice("uploads/".length));
}

function parseDataImage(value: string) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(clean(value));
  return match ? Buffer.from(match[1], "base64") : null;
}

async function loadPngImage(value: string, decision: ProviderEgressDecision): Promise<Blob> {
  const dataImage = parseDataImage(value);
  const localFile = resolveLocalUploadFile(value);
  const buffer = dataImage
    ? dataImage
    : /^https?:\/\//i.test(clean(value))
      ? await (async () => {
          const response = await fetchWithProviderEgress(decision, clean(value), {
            headers: { Accept: "image/*,*/*", "User-Agent": "Mozilla/5.0" },
          }, { purpose: "media" });
          if (!response.ok) throw new Error(`参考图下载失败 (${response.status})`);
          return Buffer.from(await response.arrayBuffer());
        })()
      : localFile
        ? await fs.readFile(localFile)
        : (() => { throw new Error("EasyRouter 图片编辑不支持该参考图路径"); })();

  if (!buffer.length) throw new Error("EasyRouter 图片编辑缺少可读取的参考图");
  const png = await sharp(buffer, { animated: false, failOn: "none" }).png().toBuffer();
  return new Blob([Uint8Array.from(png)], { type: "image/png" });
}

function readMessage(data: any) {
  return clean(data?.error?.message || data?.message || data?.error?.code || data?.code || data?.msg);
}

export async function easyRouterGenerateImage(input: EasyRouterImageInput): Promise<EasyRouterImageResult> {
  if (!isEasyRouterImageModel(input.model)) throw new Error(`不支持的 EasyRouter 图片模型: ${input.model}`);
  const imageUrls = (input.imageUrls || []).map(clean).filter(Boolean);
  if (imageUrls.length > 16) throw new Error("EasyRouter Image 2 图片编辑最多支持 16 张参考图");

  const context = await resolveProviderRequestContext("easyrouter");
  const base = trimSlash(context.provider.baseUrl) || "https://easyrouter.io/v1";
  const apiKey = resolvedProviderApiKey(context.provider);
  const inputImages = await Promise.all(imageUrls.map((imageUrl) => loadPngImage(imageUrl, context.decision)));
  const request = inputImages.length
    ? buildEasyRouterImageEditRequest({ ...input, images: inputImages })
    : buildEasyRouterImageRequest(input);
  const url = `${base}${request.endpoint}`;
  const sensitiveValues = providerErrorSensitiveValues(context.decision, apiKey, base, url);
  let response: Response;
  try {
    response = inputImages.length
      ? await fetchWithProviderEgress(context.decision, url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: request.body as unknown as UndiciRequestInit["body"],
        })
      : await fetchWithProviderEgress(context.decision, url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        });
  } catch (error) {
    if (context.decision.mode === "proxy") {
      const message = clean(error instanceof Error ? error.message : error);
      if (/407|proxy authentication/i.test(message)) {
        throw new Error("EasyRouter 代理认证失败（407）");
      }
      throw new Error(
        "EasyRouter 响应连接中断，提交结果未知；上游可能已完成并计费。请先核对 EasyRouter 调用记录，避免立即重试。",
      );
    }
    throw error;
  }
  const raw = await response.json().catch(() => ({}));
  const data = sanitizeProviderErrorFields(raw, sensitiveValues);
  if (!response.ok) {
    const message = readMessage(data);
    if (response.status === 404 && !/model\s+(?:not\s+found|unavailable|does\s+not\s+exist)|unknown\s+model/i.test(message)) {
      throw new Error("EasyRouter 图片接口不可用（HTTP 404），请检查上游接口支持情况");
    }
    throw new Error(sanitizeProviderErrorText(
      message || `EasyRouter request failed (${response.status})`,
      sensitiveValues,
      `EasyRouter request failed (${response.status})`,
    ));
  }
  const images = extractEasyRouterImageUrls(data);
  if (!images.length) {
    throw new Error(sanitizeProviderErrorText(
      readMessage(data) || "EasyRouter did not return any usable image",
      sensitiveValues,
      "EasyRouter did not return any usable image",
    ));
  }
  return { images, raw: data };
}
