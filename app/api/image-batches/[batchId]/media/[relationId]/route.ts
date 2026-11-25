import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { detachBatchMedia, ImageBatchServiceError } from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export async function DELETE(
  req: Request,
  { params }: { params: { batchId: string; relationId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    if (!/^\d+$/.test(params.relationId)) {
      throw new ImageBatchServiceError("素材关系 ID 无效", 400, "BATCH_MEDIA_ID_INVALID");
    }
    const result = await detachBatchMedia({
      authUserId,
      batchId: params.batchId,
      relationId: BigInt(params.relationId),
    });
    return imageBatchJson({ success: true, ...result });
  } catch (error) {
    return imageBatchError(error);
  }
}
