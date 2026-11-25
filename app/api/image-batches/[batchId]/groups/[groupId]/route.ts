import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";
import {
  getImageBatchGroupHistory,
  hideImageBatchGroup,
} from "@/lib/image-batch/service";

type Context = { params: { batchId: string; groupId: string } };

export async function GET(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    return imageBatchJson({
      success: true,
      group: await getImageBatchGroupHistory({
        authUserId,
        batchId: params.batchId,
        groupId: params.groupId,
      }),
    });
  } catch (error) {
    return imageBatchError(error);
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const result = await hideImageBatchGroup({
      authUserId,
      batchId: params.batchId,
      groupId: params.groupId,
    });
    return imageBatchJson({ success: true, ...result });
  } catch (error) {
    return imageBatchError(error);
  }
}
