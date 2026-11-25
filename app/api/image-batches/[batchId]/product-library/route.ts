import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  ImageBatchServiceError,
  importImageBatchProductLibraryMedia,
} from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: { batchId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ImageBatchServiceError(
        "产品库导入参数无效",
        400,
        "BATCH_PRODUCT_LIBRARY_BODY_INVALID",
      );
    }
    const role = String(body.role || "").trim();
    if (role !== "product" && role !== "reference") {
      throw new ImageBatchServiceError("素材角色无效", 400, "BATCH_MEDIA_ROLE_INVALID");
    }
    const scope = String(body.scope || "batch").trim();
    const itemId = scope === "item" ? String(body.itemId || "").trim() : "";
    if (scope === "item" && !itemId) {
      throw new ImageBatchServiceError("任务 ID 无效", 400, "BATCH_ITEM_ID_INVALID");
    }
    const result = await importImageBatchProductLibraryMedia({
      authUserId,
      batchId: params.batchId,
      productLibraryItemId: Number(body.productLibraryItemId),
      requestKey: String(body.requestKey || "").trim(),
      itemId: itemId || null,
      role,
    });
    return imageBatchJson({ success: true, ...result }, 201);
  } catch (error) {
    return imageBatchError(error);
  }
}
