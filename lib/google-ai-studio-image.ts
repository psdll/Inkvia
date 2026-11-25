import { validateGoogleImageSettings, type GoogleImageSettings } from "@/lib/google-image-settings";
import fs from "fs-extra";
import { GOOGLE_NANO_BANANA_21_MODEL, validateGoogleNanoBanana21Input } from "@/lib/google-nano-banana-21";
import path from "path";
import { resolvePublicPath } from "@/lib/public-path";
import {
  GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL,
  GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL,
  GOOGLE_AI_STUDIO_PRO_IMAGE_MODEL,
} from "@/lib/image-edit-models";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import {
  axiosWithProviderEgress,
  directAxios,
  resolveProviderRequestContext,
} from "@/lib/providers/transport";

type GoogleAiStudioImageInput = GoogleImageSettings & {
  model: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
};

type GoogleAiStudioImageResult = {
  images: string[];
  raw: any;
};

type InlineImagePart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

const GOOGLE_AI_STUDIO_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

function clean(value: unknown) {
  return String(value || "").trim();
}

function trimSlash(value: string) {
  return clean(value).replace(/\/+$/, "");
}

function getGoogleAiStudioBaseUrl() {
  const raw = trimSlash(process.env.GOOGLE_AI_STUDIO_BASE_URL || GOOGLE_AI_STUDIO_DEFAULT_BASE_URL);
  return raw || GOOGLE_AI_STUDIO_DEFAULT_BASE_URL;
}

async function resolveGoogleAiStudioEndpoint() {
  const context = await resolveProviderRequestContext("google-ai-studio");
  const base = trimSlash(context.provider.baseUrl || "") || getGoogleAiStudioBaseUrl();
  const apiKey = resolvedProviderApiKey(context.provider);
  return { base, apiKey, decision: context.decision };
}

function getMimeFromPath(value: string) {
  const ext = path.extname(value.split("?")[0] || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".avif") return "image/avif";
  if (ext === ".bmp") return "image/bmp";
  return "image/png";
}

function getUploadsRootDir() {
  const configured = clean(process.env.UPLOADS_DIR);
  if (configured) return path.resolve(configured);
  return resolvePublicPath("uploads");
}

function resolveLocalUploadFile(uploadPath: string) {
  const normalized = clean(uploadPath).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized.startsWith("uploads/")) return "";
  return path.join(getUploadsRootDir(), normalized.slice("uploads/".length));
}

function parseDataImage(value: string): InlineImagePart | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(value);
  if (!match) return null;
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2],
    },
  };
}

async function loadInlineImagePart(value: string): Promise<InlineImagePart> {
  const raw = clean(value);
  const dataPart = parseDataImage(raw);
  if (dataPart) return dataPart;

  if (/^https?:\/\//i.test(raw)) {
    const response = await directAxios<ArrayBuffer>({
      url: raw,
      method: "GET",
      responseType: "arraybuffer",
      timeout: 45000,
      proxy: false,
      headers: {
        Accept: "image/*,*/*",
        "User-Agent": "Mozilla/5.0",
      },
    }, { purpose: "media" });
    const mimeType = clean(response.headers?.["content-type"]).split(";")[0] || getMimeFromPath(raw);
    return {
      inlineData: {
        mimeType,
        data: Buffer.from(response.data).toString("base64"),
      },
    };
  }

  const localFile = resolveLocalUploadFile(raw);
  if (!localFile) throw new Error(`Google AI Studio 不支持的参考图路径: ${raw.slice(0, 100)}`);
  const buffer = await fs.readFile(localFile);
  return {
    inlineData: {
      mimeType: getMimeFromPath(localFile),
      data: buffer.toString("base64"),
    },
  };
}

function mapGoogleImageConfig(aspectRatio?: string, resolution?: string) {
  const config: Record<string, string> = {};
  const ratio = clean(aspectRatio);
  const size = clean(resolution);
  if (ratio && ratio !== "auto") config.aspectRatio = ratio;
  if (size) config.imageSize = size;
  return config;
}

// generateContent responseFormat uses protobuf enum names, unlike imageConfig.
// https://ai.google.dev/api/generate-content#ImageResponseFormat
const GOOGLE_RESPONSE_ASPECT_RATIOS: Record<string, string> = {
  "1:1": "ASPECT_RATIO_ONE_BY_ONE",
  "1:4": "ASPECT_RATIO_ONE_BY_FOUR",
  "1:8": "ASPECT_RATIO_ONE_BY_EIGHT",
  "2:3": "ASPECT_RATIO_TWO_BY_THREE",
  "3:2": "ASPECT_RATIO_THREE_BY_TWO",
  "3:4": "ASPECT_RATIO_THREE_BY_FOUR",
  "4:1": "ASPECT_RATIO_FOUR_BY_ONE",
  "4:3": "ASPECT_RATIO_FOUR_BY_THREE",
  "4:5": "ASPECT_RATIO_FOUR_BY_FIVE",
  "5:4": "ASPECT_RATIO_FIVE_BY_FOUR",
  "8:1": "ASPECT_RATIO_EIGHT_BY_ONE",
  "9:16": "ASPECT_RATIO_NINE_BY_SIXTEEN",
  "16:9": "ASPECT_RATIO_SIXTEEN_BY_NINE",
  "21:9": "ASPECT_RATIO_TWENTY_ONE_BY_NINE",
};
const GOOGLE_RESPONSE_IMAGE_SIZES: Record<string, string> = {
  "1K": "IMAGE_SIZE_ONE_K",
  "2K": "IMAGE_SIZE_TWO_K",
  "4K": "IMAGE_SIZE_FOUR_K",
};

function extractImages(data: any, excludeThoughts = false) {
  const parts = Array.isArray(data?.candidates?.[0]?.content?.parts)
    ? data.candidates[0].content.parts
    : [];
  return parts
    .filter((part: any) => !excludeThoughts || !part?.thought)
    .map((part: any) => {
      const inlineData = part?.inlineData || part?.inline_data;
      const mimeType = clean(inlineData?.mimeType || inlineData?.mime_type || "image/png");
      const imageData = clean(inlineData?.data);
      return imageData ? `data:${mimeType};base64,${imageData}` : "";
    })
    .filter(Boolean);
}

function readMessage(data: any) {
  const direct = clean(data?.error?.message || data?.message || data?.msg);
  if (direct) return direct;
  const parts = Array.isArray(data?.candidates?.[0]?.content?.parts)
    ? data.candidates[0].content.parts
    : [];
  return clean(parts.map((part: any) => part?.text).filter(Boolean).join("\n"));
}

export function isGoogleAiStudioImageModel(model: string) {
  return (
    model === GOOGLE_NANO_BANANA_21_MODEL ||
    model === GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL ||
    model === GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL ||
    model === GOOGLE_AI_STUDIO_PRO_IMAGE_MODEL
  );
}

export function buildGoogleAiStudioImageRequest(input: GoogleImageSettings & {
  model?: string;
  prompt: string;
  imageParts?: InlineImagePart[];
  aspectRatio?: string;
  resolution?: string;
}) {
  if (input.model) validateGoogleImageSettings(input.model, input);
  const parts: any[] = [{ text: clean(input.prompt) }];
  for (const image of input.imageParts || []) parts.push(image);
  const imageConfig = mapGoogleImageConfig(input.aspectRatio, input.resolution);
  return {
    contents: [{ role: "user", parts }],
    ...(input.googleSearchMode && input.googleSearchMode !== "off" ? { tools: [{ googleSearch: input.model === GOOGLE_AI_STUDIO_PRO_IMAGE_MODEL ? {} : { searchTypes: {
      ...(input.googleSearchMode !== "image" ? { webSearch: {} } : {}),
      ...(input.googleSearchMode !== "web" ? { imageSearch: {} } : {}),
    } } }] } : {}),
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(input.googleThinkingLevel ? { thinkingConfig: { thinkingLevel: input.googleThinkingLevel.toUpperCase() } } : {}),
      ...(Object.keys(imageConfig).length ? input.model === GOOGLE_NANO_BANANA_21_MODEL
        ? { responseFormat: { image: {
            ...(imageConfig.aspectRatio ? { aspectRatio: GOOGLE_RESPONSE_ASPECT_RATIOS[imageConfig.aspectRatio] } : {}),
            ...(imageConfig.imageSize ? { imageSize: GOOGLE_RESPONSE_IMAGE_SIZES[imageConfig.imageSize] } : {}),
          } } }
        : { imageConfig } : {}),
    },
  };
}

export async function googleAiStudioGenerateImage(input: GoogleAiStudioImageInput): Promise<GoogleAiStudioImageResult> {
  if (!isGoogleAiStudioImageModel(input.model)) {
    throw new Error(`不支持的 Google AI Studio 图片模型: ${input.model}`);
  }

  validateGoogleImageSettings(input.model, input);
  const isNano21 = input.model === GOOGLE_NANO_BANANA_21_MODEL;
  if (isNano21) validateGoogleNanoBanana21Input({ ...input, referenceCount: input.imageUrls?.length ?? 0 });
  const { base, apiKey, decision } = await resolveGoogleAiStudioEndpoint();
  const url = `${base}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`;
  const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, base, url);
  const imageParts = await Promise.all((input.imageUrls || []).slice(0, 16).map(loadInlineImagePart));
  const body = buildGoogleAiStudioImageRequest({
    model: input.model,
    prompt: input.prompt,
    googleThinkingLevel: input.googleThinkingLevel,
    googleSearchMode: input.googleSearchMode,
    imageParts,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution || (isNano21 ? "1K" : undefined),
  });

  const response = await axiosWithProviderEgress(decision, {
    url,
    method: "POST",
    ...(!isNano21 ? { params: { key: apiKey } } : {}),
    data: body,
    timeout: 120000,
    validateStatus: () => true,
    headers: {
      "Content-Type": "application/json",
      ...(isNano21 ? { "x-goog-api-key": apiKey } : {}),
    },
  });

  const data = sanitizeProviderErrorFields(response.data, sensitiveValues);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(sanitizeProviderErrorText(
      readMessage(data) || `Google AI Studio request failed (${response.status})`,
      sensitiveValues,
      `Google AI Studio request failed (${response.status})`,
    ));
  }

  const images = extractImages(data, true);
  if (!images.length) {
    throw new Error(sanitizeProviderErrorText(
      readMessage(data) || "Google AI Studio did not return any usable image",
      sensitiveValues,
      "Google AI Studio did not return any usable image",
    ));
  }

  return { images, raw: data };
}
