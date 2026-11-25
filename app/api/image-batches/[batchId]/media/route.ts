import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  detachSharedBatchMediaByRole,
  ImageBatchServiceError,
  uploadAndAttachBatchMediaFiles,
} from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";
import { assertRequestContentLengthUnderLimit } from "@/lib/upload-limits";

export const runtime = "nodejs";

function isFileLike(value: unknown): value is File {
  const file = value as File | null;
  return Boolean(file && file.size > 0 && typeof file.arrayBuffer === "function");
}

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    assertRequestContentLengthUnderLimit(req);
    const form = await req.formData();
    const files = form.getAll("file").filter(isFileLike);
    const draftSessionId = String(form.get("draftSessionId") || "").trim();
    const role = String(form.get("role") || "reference").trim();
    const scope = String(form.get("scope") || "batch").trim();
    const itemId = scope === "item" ? String(form.get("itemId") || "").trim() : "";
    if (!files.length || !draftSessionId) {
      return imageBatchJson({ success: false, error: apiMessage("me9a7e958db22") }, 400);
    }
    const upload = await uploadAndAttachBatchMediaFiles({
      authUserId,
      batchId: params.batchId,
      draftSessionId,
      files,
      role,
      itemId: itemId || null,
    });
    return imageBatchJson({
      success: true,
      relations: upload.relations,
      version: upload.version,
    }, 201);
  } catch (error) {
    return imageBatchError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const role = new URL(req.url).searchParams.get("role");
    if (role !== "product" && role !== "reference") {
      throw new ImageBatchServiceError("素材类型无效", 400, "BATCH_MEDIA_ROLE_INVALID");
    }
    const result = await detachSharedBatchMediaByRole({
      authUserId,
      batchId: params.batchId,
      role,
    });
    return imageBatchJson({ success: true, ...result });
  } catch (error) {
    return imageBatchError(error);
  }
}

// Storage is deliberately selected in the shared service as storageProfile: "batch",
// never from form fields.
