import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  cancelBatchItemOutputs,
  cancelQueuedBatchOutputs,
} from "@/lib/image-batch/submission";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const result = body?.itemId
      ? await cancelBatchItemOutputs({
          authUserId,
          batchId: params.batchId,
          itemId: String(body.itemId),
        })
      : await cancelQueuedBatchOutputs({ authUserId, batchId: params.batchId });
    return imageBatchJson({ success: true, ...result });
  } catch (error) {
    return imageBatchError(error);
  }
}
