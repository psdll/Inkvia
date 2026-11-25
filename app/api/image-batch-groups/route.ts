import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";
import {
  listImageBatchGroups,
  listImageBatchGroupStatuses,
} from "@/lib/image-batch/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const started = performance.now();
  const authUserId = await getUserId(req);
  const authenticated = performance.now();
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("statusOnly") === "1") {
      return imageBatchJson({
        success: true,
        groups: await listImageBatchGroupStatuses({
          authUserId,
          batchIds: url.searchParams.get("batchIds"),
        }),
      });
    }
    const result = await listImageBatchGroups({
      authUserId,
      mode: url.searchParams.get("mode"),
      cursor: url.searchParams.get("cursor"),
      take: url.searchParams.get("take"),
    });
    const loaded = performance.now();
    const response = imageBatchJson({ success: true, ...result });
    if (process.env.NODE_ENV === "development") {
      const serialized = performance.now();
      response.headers.set("Server-Timing", [
        `auth;dur=${(authenticated - started).toFixed(1)}`,
        `data;dur=${(loaded - authenticated).toFixed(1)}`,
        `serialize;dur=${(serialized - loaded).toFixed(1)}`,
        `total;dur=${(serialized - started).toFixed(1)}`,
      ].join(", "));
    }
    return response;
  } catch (error) {
    return imageBatchError(error);
  }
}
