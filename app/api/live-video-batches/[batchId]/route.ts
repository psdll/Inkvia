import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  getOwnedLiveVideoBatch,
  softDeleteLiveVideoBatch,
  updateLiveVideoBatchDraft,
} from "@/lib/live-video-batch/service";
import {
  liveVideoBatchError,
  liveVideoBatchJson,
} from "@/lib/live-video-batch/http";

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

export async function PATCH(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const batch = await updateLiveVideoBatchDraft({
      authUserId,
      batchId: params.batchId,
      expectedVersion: body?.expectedVersion,
      name: body?.name,
      ...(Object.prototype.hasOwnProperty.call(body, "workspaceSkillPublicId")
        ? { workspaceSkillPublicId: body.workspaceSkillPublicId }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "sharedRequirement")
        ? { sharedRequirement: body.sharedRequirement }
        : {}),
      videoSettings: body?.videoSettings,
      itemPrompts: body?.itemPrompts,
    });
    return liveVideoBatchJson({ success: true, batch });
  } catch (error) {
    return liveVideoBatchError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return liveVideoBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    return liveVideoBatchJson({
      success: true,
      ...(await softDeleteLiveVideoBatch(params.batchId, authUserId)),
    });
  } catch (error) {
    return liveVideoBatchError(error);
  }
}
