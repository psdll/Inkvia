import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { updateLiveVideoBatchDraft } from "@/lib/live-video-batch/service";
import { liveVideoBatchError, liveVideoBatchJson } from "@/lib/live-video-batch/http";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { batchId: string; itemId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const batch = await updateLiveVideoBatchDraft({
      authUserId,
      batchId: params.batchId,
      expectedVersion: body?.expectedVersion,
      itemPrompts: [{ itemId: params.itemId, prompt: body?.prompt }],
    });
    return liveVideoBatchJson({ success: true, batch });
  } catch (error) {
    return liveVideoBatchError(error);
  }
}
