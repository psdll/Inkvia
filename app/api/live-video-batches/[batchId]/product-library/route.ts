import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { importLiveVideoBatchProductLibraryMedia } from "@/lib/live-video-batch/service";
import {
  liveVideoBatchError,
  liveVideoBatchJson,
} from "@/lib/live-video-batch/http";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: { batchId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  }
  try {
    const body = await req.json().catch(() => ({}));
    const batch = await importLiveVideoBatchProductLibraryMedia({
      authUserId,
      batchId: params.batchId,
      itemId: body?.itemId,
      productLibraryItemId: body?.productLibraryItemId,
      requestKey: body?.requestKey,
      expectedVersion: body?.expectedVersion,
    });
    return liveVideoBatchJson({ success: true, batch }, 201);
  } catch (error) {
    return liveVideoBatchError(error);
  }
}
