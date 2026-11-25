import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { retryLiveVideoPrompt } from "@/lib/live-video-batch/service";
import { liveVideoBatchError, liveVideoBatchJson } from "@/lib/live-video-batch/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const batch = await retryLiveVideoPrompt({
      authUserId,
      batchId: params.batchId,
      itemId: String(body?.itemId || ""),
      requestKey: body?.requestKey,
    });
    return liveVideoBatchJson({ success: true, batch });
  } catch (error) {
    return liveVideoBatchError(error);
  }
}
