import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  detachLiveVideoItemMedia,
  uploadAndReplaceLiveVideoItemMedia,
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
  { params }: { params: { batchId: string; itemId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  }
  try {
    assertRequestContentLengthUnderLimit(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!isFileLike(file)) {
      return liveVideoBatchJson({ success: false, error: apiMessage("m74335e926fd8") }, 400);
    }
    const batch = await uploadAndReplaceLiveVideoItemMedia({
      authUserId,
      batchId: params.batchId,
      itemId: params.itemId,
      expectedVersion: form.get("expectedVersion"),
      draftSessionId: String(form.get("draftSessionId") || "").trim(),
      file,
    });
    return liveVideoBatchJson({ success: true, batch }, 201);
  } catch (error) {
    return liveVideoBatchError(error);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { batchId: string; itemId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  }
  try {
    const body = await req.json().catch(() => ({}));
    const batch = await detachLiveVideoItemMedia({
      authUserId,
      batchId: params.batchId,
      itemId: params.itemId,
      expectedVersion: body?.expectedVersion,
    });
    return liveVideoBatchJson({ success: true, batch });
  } catch (error) {
    return liveVideoBatchError(error);
  }
}
