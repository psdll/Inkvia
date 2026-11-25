import { apiMessage } from "@/i18n/api-message";
import { getUserId } from "@/lib/server-auth";
import {
  createDetachedSegmentedPromptGroup,
  createDetachedStyleReplicationGroup,
  createStyleReplicationGroups,
} from "@/lib/image-batch/service";
import { imageBatchError, imageBatchJson } from "@/lib/image-batch/http";

export async function POST(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return imageBatchJson({ success: false, error: apiMessage("m48144f96c150") }, 401);
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("detached") === "1") {
      const body = await req.json().catch(() => ({}));
      if (url.searchParams.get("kind") === "segmented_prompts") {
        const result = await createDetachedSegmentedPromptGroup({
          authUserId,
          templateBatchId: params.batchId,
          requestKey: body?.requestKey,
          sharedPrompt: body?.sharedPrompt,
          sharedSettings: body?.sharedSettings,
          generatedPrompt: body?.generatedPrompt,
          skill: body?.skill,
          mediaSnapshots: body?.mediaSnapshots,
        });
        return imageBatchJson({ success: true, ...result }, 201);
      }
      const result = await createDetachedStyleReplicationGroup({
        authUserId,
        templateBatchId: params.batchId,
        sharedPrompt: body?.sharedPrompt,
        sharedSettings: body?.sharedSettings,
      });
      return imageBatchJson({ success: true, ...result }, 201);
    }
    const batch = await createStyleReplicationGroups({
      authUserId,
      batchId: params.batchId,
    });
    return imageBatchJson({ success: true, batch }, 201);
  } catch (error) {
    return imageBatchError(error);
  }
}
