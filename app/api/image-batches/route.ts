import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  createImageBatch,
  getOrCreateImageBatchTemplate,
  listImageBatches,
} from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const templateMode = new URL(req.url).searchParams.get("templateMode");
    if (templateMode) {
      const batch = await getOrCreateImageBatchTemplate({ authUserId, mode: templateMode });
      return imageBatchJson({ success: true, batch });
    }
    return imageBatchJson({ success: true, batches: await listImageBatches(authUserId) });
  } catch (error) {
    return imageBatchError(error);
  }
}

export async function POST(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const batch = await createImageBatch({
      authUserId,
      name: body?.name,
      mode: body?.mode,
      cloneFromBatchId: body?.cloneFromBatchId,
    });
    return imageBatchJson({ success: true, batch }, 201);
  } catch (error) {
    return imageBatchError(error);
  }
}
