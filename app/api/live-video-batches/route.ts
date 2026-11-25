import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  createLiveVideoBatch,
  getLiveVideoDefaultSkill,
  getOrCreateLiveVideoDraft,
  LIVE_VIDEO_HISTORY_PAGE_SIZE,
  listLiveVideoBatchStatuses,
  listLiveVideoBatches,
} from "@/lib/live-video-batch/service";
import {
  liveVideoBatchError,
  liveVideoBatchJson,
} from "@/lib/live-video-batch/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const url = new URL(req.url);
    const statusOnly = url.searchParams.get("statusOnly") === "1";
    if (statusOnly) {
      const batchIds = String(url.searchParams.get("batchIds") || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const batches = await listLiveVideoBatchStatuses({ authUserId, batchIds });
      return liveVideoBatchJson({ success: true, batches });
    }

    const historyRequest = () => listLiveVideoBatches({
        authUserId,
        cursor: url.searchParams.get("cursor"),
        take: LIVE_VIDEO_HISTORY_PAGE_SIZE,
      });
    const historyOnly = url.searchParams.get("historyOnly") === "1";
    if (historyOnly) {
      const history = await historyRequest();
      return liveVideoBatchJson({ success: true, ...history });
    }

    const [draft, history, defaultSkill] = await Promise.all([
      getOrCreateLiveVideoDraft(authUserId, url.searchParams.get("draftSessionId") || undefined),
      historyRequest(),
      getLiveVideoDefaultSkill(authUserId),
    ]);
    return liveVideoBatchJson({ success: true, draft, defaultSkill, ...history });
  } catch (error) {
    return liveVideoBatchError(error);
  }
}

export async function POST(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const batch = await createLiveVideoBatch({
      authUserId,
      requestKey: body?.requestKey,
      name: body?.name,
      skillPublicId: body?.skillPublicId,
      sharedRequirement: body?.sharedRequirement,
      videoSettings: body?.videoSettings,
      sourceBatchId: body?.sourceBatchId,
    });
    return liveVideoBatchJson({ success: true, batch }, 201);
  } catch (error) {
    return liveVideoBatchError(error);
  }
}
