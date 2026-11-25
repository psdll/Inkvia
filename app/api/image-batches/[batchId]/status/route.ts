import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { getOwnedImageBatch } from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const batch = await getOwnedImageBatch(params.batchId, authUserId);
    const updatedAfter = new URL(req.url).searchParams.get("updatedAfter");
    const changed = !updatedAfter || new Date(batch.updatedAt).getTime() > new Date(updatedAfter).getTime();
    return imageBatchJson({ success: true, changed, serverTime: new Date(), batch: changed ? batch : undefined });
  } catch (error) {
    return imageBatchError(error);
  }
}
