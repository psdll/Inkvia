import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { getOwnedImageBatch, previewBatchPrompts } from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    await getOwnedImageBatch(params.batchId, authUserId);
    const body = await req.json();
    return imageBatchJson({ success: true, prompts: previewBatchPrompts(body?.text) });
  } catch (error) {
    return imageBatchError(error);
  }
}
