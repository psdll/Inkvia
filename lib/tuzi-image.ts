import fs from "fs-extra";
import path from "path";
import sharp from "sharp";
import type { RequestInit as UndiciRequestInit } from "undici";
import { resolvePublicPath } from "@/lib/public-path";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import {
  providerErrorSensitiveValues,
  sanitizeProviderErrorFields,
  sanitizeProviderErrorText,
} from "@/lib/providers/error-safety";
import {
  fetchWithProviderEgress,
  resolveProviderRequestContext,
  type ProviderEgressDecision,
} from "@/lib/providers/transport";
import {
  TUZI_GPT_IMAGE_2_MODEL_ID,
  TUZI_GPT_IMAGE_2_UPSTREAM_MODEL,
  TUZI_PROVIDER_ID,
  mapTuziGptImage2Size,
  normalizeTuziGptImage2Params,
} from "@/lib/tuzi-image-params";

export type TuziImageInput = {
  model: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  imageUrls?: string[];
  maskUrl?: string;
};

export type TuziImageResult = {
  images: string[];
  raw: unknown;
};

type TuziImageRequestInput = Pick<
  TuziImageInput,
  "prompt" | "aspectRatio" | "resolution" | "quality"
>;

type PreparedPng = {
  blob: Blob;
  width: number;
  height: number;
};

const MAX_REFERENCE_IMAGES = 16;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function trimSlash(value: string) {
  return clean(value).replace(/\/+$/, "");
}

function assertPrompt(prompt: string, maxLength: number) {
  if (!prompt) throw new Error("GPT-Image-2（tz）缺少提示词");
  if (prompt.length > maxLength) {
    throw new Error(`GPT-Image-2（tz）提示词不能超过 ${maxLength} 个字符`);
  }
}

function assertPngBlob(blob: Blob, label: string) {
  if (blob.type !== "image/png") throw new Error(`${label}必须是 PNG`);
  if (!blob.size) throw new Error(`${label}不能为空`);
}

export function buildTuziImageRequest(input: TuziImageRequestInput) {
  const prompt = clean(input.prompt);
  assertPrompt(prompt, 5000);
  const params = normalizeTuziGptImage2Params(input);
  return {
    endpoint: "/images/generations",
    body: {
      model: TUZI_GPT_IMAGE_2_UPSTREAM_MODEL,
      prompt,
      n: 1,
      size: mapTuziGptImage2Size(params.aspectRatio, params.resolution),
      quality: params.quality,
      output_format: "png",
    },
  };
}

export function buildTuziImageEditRequest(
  input: TuziImageRequestInput & { images: Blob[]; mask?: Blob },
) {
  const prompt = clean(input.prompt);
  assertPrompt(prompt, 1000);
  if (!input.images.length) throw new Error("GPT-Image-2（tz）图片编辑缺少参考图");
  if (input.images.length > MAX_REFERENCE_IMAGES) {
    throw new Error("GPT-Image-2（tz）最多支持 16 张参考图");
  }
  input.images.forEach((image, index) => assertPngBlob(image, `第 ${index + 1} 张参考图`));
  if (input.mask) assertPngBlob(input.mask, "遮罩图");

  const params = normalizeTuziGptImage2Params(input);
  const body = new FormData();
  body.set("model", TUZI_GPT_IMAGE_2_UPSTREAM_MODEL);
  body.set("prompt", prompt);
  body.set("n", "1");
  body.set("size", mapTuziGptImage2Size(params.aspectRatio, params.resolution));
  body.set("quality", params.quality);
  body.set("output_format", "png");
  input.images.forEach((image, index) => {
    body.append("image[]", image, `image-${index + 1}.png`);
  });
  if (input.mask) body.set("mask", input.mask, "mask.png");
  return { endpoint: "/images/edits", body };
}

export function extractTuziImageUrls(data: any) {
  const images: string[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(data?.data) ? data.data : []) {
    const url = clean(item?.url);
    const base64 = clean(item?.b64_json);
    const image = url || (base64 ? `data:image/png;base64,${base64}` : "");
    if (image && !seen.has(image)) {
      seen.add(image);
      images.push(image);
    }
  }
  return images;
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

async function loadPngImage(value: string, decision: ProviderEgressDecision): Promise<PreparedPng> {
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
        : (() => { throw new Error("GPT-Image-2（tz）不支持该参考图路径"); })();

  if (!buffer.length) throw new Error("GPT-Image-2（tz）缺少可读取的参考图");
  const png = await sharp(buffer, { animated: false, failOn: "none" }).png().toBuffer();
  const metadata = await sharp(png).metadata();
  const blob = new Blob([Uint8Array.from(png)], { type: "image/png" });
  assertPngBlob(blob, "参考图");
  return {
    blob,
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
  };
}

function readMessage(data: any) {
  return clean(data?.error?.message || data?.message || data?.error?.code || data?.code || data?.msg);
}

export async function readTuziImageResponse(
  response: Response,
  sensitiveValues: string[] = [],
): Promise<TuziImageResult> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`TuZi request failed (${response.status})`);
    }
    throw new Error(sanitizeProviderErrorText(
      "兔子 API 响应数据读取中断，提交结果未知；上游可能已完成并计费。请先核对兔子 API 调用记录，避免立即重试。",
      sensitiveValues,
      "兔子 API 响应数据读取中断，提交结果未知",
    ));
  }

  const data = sanitizeProviderErrorFields(raw, sensitiveValues);
  if (!response.ok) {
    throw new Error(sanitizeProviderErrorText(
      readMessage(data) || `TuZi request failed (${response.status})`,
      sensitiveValues,
      `TuZi request failed (${response.status})`,
    ));
  }
  const images = extractTuziImageUrls(data);
  if (!images.length) {
    throw new Error(sanitizeProviderErrorText(
      readMessage(data) || "兔子 API 未返回可用图片",
      sensitiveValues,
      "兔子 API 未返回可用图片",
    ));
  }
  return { images, raw: data };
}

export async function tuziGenerateImage(input: TuziImageInput): Promise<TuziImageResult> {
  if (clean(input.model) !== TUZI_GPT_IMAGE_2_MODEL_ID) {
    throw new Error(`不支持的兔子图片模型: ${input.model}`);
  }
  const imageUrls = (input.imageUrls || []).map(clean).filter(Boolean);
  if (imageUrls.length > MAX_REFERENCE_IMAGES) {
    throw new Error("GPT-Image-2（tz）最多支持 16 张参考图");
  }

  const context = await resolveProviderRequestContext(TUZI_PROVIDER_ID);
  const base = trimSlash(context.provider.baseUrl) || "https://api.tu-zi.com/v1";
  const apiKey = resolvedProviderApiKey(context.provider);
  const preparedImages = await Promise.all(
    imageUrls.map((imageUrl) => loadPngImage(imageUrl, context.decision)),
  );
  const preparedMask = clean(input.maskUrl)
    ? await loadPngImage(clean(input.maskUrl), context.decision)
    : null;
  if (
    preparedMask
    && preparedImages[0]
    && (preparedMask.width !== preparedImages[0].width || preparedMask.height !== preparedImages[0].height)
  ) {
    throw new Error("GPT-Image-2（tz）遮罩图必须与第一张参考图尺寸一致");
  }
  const request = preparedImages.length
    ? buildTuziImageEditRequest({
        ...input,
        images: preparedImages.map((image) => image.blob),
        mask: preparedMask?.blob,
      })
    : buildTuziImageRequest(input);
  const url = `${base}${request.endpoint}`;
  const sensitiveValues = providerErrorSensitiveValues(context.decision, apiKey, base, url);

  let response: Response;
  try {
    response = preparedImages.length
      ? await fetchWithProviderEgress(context.decision, url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: request.body as unknown as UndiciRequestInit["body"],
        })
      : await fetchWithProviderEgress(context.decision, url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request.body),
        });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error);
    if (/407|proxy authentication/i.test(message)) {
      throw new Error("兔子 API 代理认证失败（407）");
    }
    throw new Error(sanitizeProviderErrorText(
      "兔子 API 响应连接中断，提交结果未知；上游可能已完成并计费。请先核对兔子 API 调用记录，避免立即重试。",
      sensitiveValues,
      "兔子 API 请求连接中断",
    ));
  }

  return readTuziImageResponse(response, sensitiveValues);
}
