import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  getOwnedImageBatch,
  softDeleteImageBatch,
  updateImageBatchDraft,
} from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export const dynamic = "force-dynamic";
const BATCH_VERSION_CONFLICT = "BATCH_VERSION_CONFLICT";
const BATCH_NOT_FOUND = "BATCH_NOT_FOUND";
void BATCH_VERSION_CONFLICT;
void BATCH_NOT_FOUND;

type Context = { params: { batchId: string } };

export async function GET(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    return imageBatchJson({ success: true, batch: await getOwnedImageBatch(params.batchId, authUserId) });
  } catch (error) {
    return imageBatchError(error);
  }
}

export async function PATCH(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json();
    const result = await updateImageBatchDraft({
      authUserId,
      batchId: params.batchId,
      expectedVersion: Number(body?.expectedVersion),
      batch: body?.batch,
      itemChanges: Array.isArray(body?.itemChanges) ? body.itemChanges : [],
      groupChanges: Array.isArray(body?.groupChanges) ? body.groupChanges : [],
    });
    return imageBatchJson({ success: true, ...result });
  } catch (error) {
    return imageBatchError(error);
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    return imageBatchJson({ success: true, ...(await softDeleteImageBatch(params.batchId, authUserId)) });
  } catch (error) {
    return imageBatchError(error);
  }
}
