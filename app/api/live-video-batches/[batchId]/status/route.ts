import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { getOwnedLiveVideoBatch } from "@/lib/live-video-batch/service";
import { liveVideoBatchError, liveVideoBatchJson } from "@/lib/live-video-batch/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    return liveVideoBatchJson({
      success: true,
      batch: await getOwnedLiveVideoBatch(params.batchId, authUserId),
    });
  } catch (error) {
    return liveVideoBatchError(error);
  }
}
