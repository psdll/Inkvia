import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { uploadToolMedia, uploadToolMediaFromSource } from "@/lib/tool-media/service";
import { assertRequestContentLengthUnderLimit } from "@/lib/upload-limits";
import { modelSupportsReferenceAudio } from "@/lib/sora2";
import { getSeedanceUploadContract } from "@/lib/seedance-media-policy";
import { getMiniMaxH3UploadContract } from "@/lib/minimax-h3-media-policy";
import { getWanUploadContract } from "@/lib/wan-media-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isFileLike(value: unknown): value is File {
  const file = value as File | null;
  return Boolean(
    file
      && typeof file.name === "string"
      && typeof file.type === "string"
      && typeof file.size === "number"
      && file.size > 0
      && typeof file.arrayBuffer === "function"
      && typeof file.slice === "function",
  );
}

function errorResponse(error: any) {
  const status = Number(error?.status);
  return NextResponse.json(
    {
      success: false,
      error: apiErrorMessage(String(error?.message || "上传素材失败")),
      ...(typeof error?.code === "string" ? { code: error.code } : {}),
      ...(Array.isArray(error?.issues) ? { issues: error.issues } : {}),
    },
    { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500 },
  );
}

export async function POST(req: Request) {
  const ownerUserId = await getUserId(req);
  if (!ownerUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }

  try {
    assertRequestContentLengthUnderLimit(req);
    const form = await req.formData();
    const draftSessionId = String(form.get("draftSessionId") || "").trim();
    const model = String(form.get("model") || "").trim();
    const sourceUrl = String(form.get("sourceUrl") || "").trim();
    const entries = form.getAll("file");
    if (!UUID_PATTERN.test(draftSessionId)) {
      return NextResponse.json({ success: false, error: apiMessage("m5e7f56b8a91b") }, { status: 400 });
    }
    const file = entries.length === 1 && isFileLike(entries[0]) ? entries[0] : null;
    if ((!file && !sourceUrl) || (file && sourceUrl) || entries.length > 1) {
      return NextResponse.json({ success: false, error: apiMessage("m49d9f9ad1329") }, { status: 400 });
    }

    const modelContract = getSeedanceUploadContract(model) || getMiniMaxH3UploadContract(model) || getWanUploadContract(model);
    const uploadOptions = {
      ownerUserId,
      draftSessionId,
      ...(modelContract ? {
        modelId: model,
        allowedKinds: modelContract.allowedKinds,
        maxBytes: modelContract.maxBytes,
        allowedMimeTypes: modelContract.allowedMimeTypes,
        allowedAudioMimeTypes: modelContract.allowedAudioMimeTypes,
      } : modelSupportsReferenceAudio(model) ? {
        allowedKinds: ["image", "video", "audio"] as Array<"image" | "video" | "audio">,
        maxBytes: { audio: 15 * 1024 * 1024 },
        allowedAudioMimeTypes: [
          "audio/mpeg",
          "audio/mp3",
          "audio/wav",
          "audio/x-wav",
          "audio/wave",
          "audio/vnd.wave",
        ],
      } : {}),
    };
    const result = sourceUrl
      ? await uploadToolMediaFromSource({ ...uploadOptions, sourceUrl })
      : await uploadToolMedia({ ...uploadOptions, file: file! });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return errorResponse(error);
  }
}
