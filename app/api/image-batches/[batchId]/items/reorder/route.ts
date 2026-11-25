import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { reorderBatchItems } from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json();
    const batch = await reorderBatchItems({
      authUserId,
      batchId: params.batchId,
      itemIds: Array.isArray(body?.itemIds) ? body.itemIds : [],
    });
    return imageBatchJson({ success: true, batch });
  } catch (error) {
    return imageBatchError(error);
  }
}
