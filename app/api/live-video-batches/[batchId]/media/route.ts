import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  detachLiveVideoDraftMedia,
  uploadAndAttachLiveVideoDraftMediaFiles,
} from "@/lib/live-video-batch/service";
import {
  liveVideoBatchError,
  liveVideoBatchJson,
} from "@/lib/live-video-batch/http";
import { assertRequestContentLengthUnderLimit } from "@/lib/upload-limits";

export const runtime = "nodejs";

function isFileLike(value: unknown): value is File {
  const file = value as File | null;
  return Boolean(file && file.size > 0 && typeof file.arrayBuffer === "function");
}

export async function POST(
  req: Request,
  { params }: { params: { batchId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    assertRequestContentLengthUnderLimit(req);
    const form = await req.formData();
    const files = form.getAll("file").filter(isFileLike);
    if (!files.length) {
      return liveVideoBatchJson({ success: false, error: apiMessage("m74335e926fd8") }, 400);
    }
    const draft = await uploadAndAttachLiveVideoDraftMediaFiles({
      authUserId,
      batchId: params.batchId,
      expectedVersion: form.get("expectedVersion"),
      draftSessionId: String(form.get("draftSessionId") || "").trim(),
      files,
    });
    return liveVideoBatchJson({
      success: true,
      draft,
      uploadedFileCount: files.length,
    }, 201);
  } catch (error) {
    return liveVideoBatchError(error);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { batchId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const draft = await detachLiveVideoDraftMedia({
      authUserId,
      batchId: params.batchId,
      itemId: body?.itemId,
      expectedVersion: body?.expectedVersion,
    });
    return liveVideoBatchJson({ success: true, draft });
  } catch (error) {
    return liveVideoBatchError(error);
  }
}
