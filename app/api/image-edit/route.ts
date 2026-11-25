import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import {
  createImageGenerationBatch,
  createImageGenerationInputFromFormData,
  ImageGenerationError,
} from "@/lib/generation/image-service";
import { toPublicFriendlyError } from "@/lib/error-friendly";
import { sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import { ToolMediaInputError } from "@/lib/tool-media/generation-inputs";
import { GenerationInputManifestError } from "@/lib/generation/input-manifest";

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
  }

  const formData = await req.formData();
  let input: ReturnType<typeof createImageGenerationInputFromFormData>;
  try {
    input = createImageGenerationInputFromFormData(authUserId, formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "素材 ID 格式不正确";
    const status =
      error instanceof ToolMediaInputError ||
      error instanceof GenerationInputManifestError
        ? error.status
        : 400;
    return NextResponse.json({ success: false, error: apiErrorMessage(message) }, { status });
  }

  try {
    const result = await createImageGenerationBatch(input);
    const firstSuccessfulTask = result.tasks.find((task) => task.status !== "failed");
    if (!firstSuccessfulTask) {
      return NextResponse.json({
        success: false,
        error: apiErrorMessage(result.tasks[0]?.error || apiMessage("m470f92db3d64")),
        data: { batchId: result.batchId, tasks: result.tasks },
      }, { status: result.tasks[0]?.errorStatus || 502 });
    }
    return NextResponse.json({
      success: true,
      data: {
        generationId: firstSuccessfulTask.generationId,
        taskId: firstSuccessfulTask.taskId,
        batchId: result.batchId,
        taskCount: result.taskCount,
        succeededCount: result.succeededCount,
        failedCount: result.failedCount,
        tasks: result.tasks,
      },
    });
  } catch (error: any) {
    if (error instanceof ImageGenerationError) {
      return NextResponse.json(
        {
          success: false,
          error: apiErrorMessage(error.friendlyError.message),
          friendlyError: toPublicFriendlyError(error.friendlyError),
          data: error.generationId ? { generationId: error.generationId } : undefined,
        },
        { status: error.status }
      );
    }

    const message = sanitizeProviderErrorText(error?.message || "生成失败", [], "生成失败");
    return NextResponse.json({ success: false, error: apiErrorMessage(message) }, { status: 500 });
  }
}
