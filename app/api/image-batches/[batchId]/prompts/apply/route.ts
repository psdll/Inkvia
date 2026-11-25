import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { applyBatchPrompts } from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json();
    const batch = await applyBatchPrompts({
      authUserId,
      batchId: params.batchId,
      prompts: Array.isArray(body?.prompts) ? body.prompts : [],
    });
    return imageBatchJson({ success: true, batch }, 201);
  } catch (error) {
    return imageBatchError(error);
  }
}
