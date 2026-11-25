import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { submitImageBatch } from "@/lib/image-batch/submission";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const result = await submitImageBatch({
      authUserId,
      batchId: params.batchId,
      idempotencyKey: String(req.headers.get("Idempotency-Key") || ""),
      itemIds: Array.isArray(body?.itemIds) ? body.itemIds.map(String) : undefined,
    });
    return imageBatchJson({ success: true, ...result }, 202);
  } catch (error) {
    return imageBatchError(error);
  }
}
