import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { saveUploadedFile } from "@/lib/storage";
import {
  createVideoGeneration,
  VideoGenerationError,
  type CreateVideoGenerationInput,
} from "@/lib/generation/video-service";
import { normalizeGenerationSkillSnapshot } from "@/lib/generation/skill-metadata";
import { toPublicFriendlyError } from "@/lib/error-friendly";
import { sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import { parseToolMediaIdsFromFormData, ToolMediaInputError } from "@/lib/tool-media/generation-inputs";
import { validate as validateUuid } from "uuid";
import {
  GenerationInputManifestError,
  assertGenerationInputManifestMatches,
  parseGenerationInputManifest,
  type GenerationInputManifestV1,
} from "@/lib/generation/input-manifest";
import { getSeedanceUploadContract } from "@/lib/seedance-media-policy";
import { getMiniMaxH3UploadContract } from "@/lib/minimax-h3-media-policy";
import { normalizeVideoModelId } from "@/lib/sora2";
import { validateUploadFile } from "@/lib/upload-validation";

function mapMediaPaths(formData: FormData) {
  const rawList = [
    ...formData.getAll("mediaPath"),
    ...formData.getAll("mediaPath[]"),
    ...formData.getAll("mediaPaths"),
    ...formData.getAll("mediaPaths[]"),
  ];

  return rawList.map((v) => String(v || "").trim()).filter(Boolean);
}

function parseBoolean(raw: FormDataEntryValue | null, fallback = false): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseOptionalInt(raw: FormDataEntryValue | null): number | undefined {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseRequestKey(raw: FormDataEntryValue | null): string | undefined {
  const requestKey = String(raw || "").trim().toLowerCase();
  if (!requestKey) return undefined;
  if (!validateUuid(requestKey)) throw new Error("requestKey 必须是有效的 UUID");
  return requestKey;
}

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
  }

  const formData = await req.formData();
  const media = formData.get("media");
  const mediaPaths = mapMediaPaths(formData);
  let toolMediaIds: string[];
  let requestKey: string | undefined;
  let inputManifest: GenerationInputManifestV1 | null;
  try {
    toolMediaIds = parseToolMediaIdsFromFormData(formData);
    requestKey = parseRequestKey(formData.get("requestKey"));
    inputManifest = parseGenerationInputManifest(formData.get("inputManifest"));
    assertGenerationInputManifestMatches(inputManifest, toolMediaIds, mediaPaths);
    if (
      !inputManifest &&
      toolMediaIds.length &&
      (mediaPaths.length || media instanceof File)
    ) {
      throw new GenerationInputManifestError(
        "素材来源已混合但缺少顺序信息，请刷新页面后重新提交",
      );
    }
    if (inputManifest && media instanceof File) {
      throw new GenerationInputManifestError(
        "当前素材尚未完成统一上传，请重新添加后再提交",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "素材 ID 格式不正确";
    const status =
      error instanceof ToolMediaInputError ||
      error instanceof GenerationInputManifestError
        ? error.status
        : 400;
    return NextResponse.json({ success: false, error: apiErrorMessage(message) }, { status });
  }

  if (toolMediaIds.length === 0 && media instanceof File && mediaPaths.length === 0) {
    const model = normalizeVideoModelId(String(formData.get("model") || "").trim());
    const contract = getSeedanceUploadContract(model) || getMiniMaxH3UploadContract(model);
    if (contract) {
      const validation = await validateUploadFile(
        media,
        contract.allowedKinds,
        contract.maxBytes,
        contract.allowedMimeTypes,
      );
      if (!validation.ok) {
        return NextResponse.json(
          { success: false, error: apiErrorMessage(validation.error || apiMessage("m5f563e310ed2")) },
          { status: 400 },
        );
      }
    }
    const uploadedPath = await saveUploadedFile(media, "images/user-uploads");
    mediaPaths.push(uploadedPath);
  }

  const input: CreateVideoGenerationInput = {
    authUserId,
    requestKey,
    prompt: String(formData.get("prompt") || "").trim(),
    userPrompt: String(formData.get("userPrompt") || "").trim() || undefined,
    skill: normalizeGenerationSkillSnapshot(formData.get("skill")) || undefined,
    source: String(formData.get("source") || "").trim() === "agent" ? "agent" : "tool",
    model: String(formData.get("model") || "").trim(),
    mediaPaths,
    toolMediaIds,
    inputManifest: inputManifest || undefined,
    inputMode: String(formData.get("inputMode") || "").trim(),
    resolution: String(formData.get("resolution") || "").trim(),
    ratio: String(formData.get("ratio") || formData.get("aspectRatio") || "9:16").trim(),
    duration: parseOptionalInt(formData.get("duration")),
    seed: parseOptionalInt(formData.get("seed")),
    cameraFixed: parseBoolean(formData.get("cameraFixed"), false),
    watermark: parseBoolean(formData.get("watermark"), false),
    returnLastFrame: parseBoolean(formData.get("returnLastFrame"), false),
    generateAudio: parseBoolean(formData.get("generateAudio"), false),
    webSearch: parseBoolean(formData.get("webSearch"), false),
    omniReferenceTaskType: String(formData.get("omniReferenceTaskType") || "").trim() as CreateVideoGenerationInput["omniReferenceTaskType"],
    outputFormat: String(formData.get("outputFormat") || "").trim() as CreateVideoGenerationInput["outputFormat"],
  };

  try {
    const result = await createVideoGeneration(input);
    return NextResponse.json({
      success: true,
      data: {
        generationId: result.generationId,
        taskId: result.taskId,
      },
    });
  } catch (error: any) {
    if (error instanceof VideoGenerationError) {
      return NextResponse.json(
        {
          success: false,
          error: apiErrorMessage(error.friendlyError.message),
          friendlyError: toPublicFriendlyError(error.friendlyError),
          displayInHistory: error.displayInHistory,
          data: error.generationId ? { generationId: error.generationId } : undefined,
        },
        { status: error.status }
      );
    }

    const message = sanitizeProviderErrorText(error?.message || "生成失败", [], "生成失败");
    return NextResponse.json({ success: false, error: apiErrorMessage(message) }, { status: 500 });
  }
}
