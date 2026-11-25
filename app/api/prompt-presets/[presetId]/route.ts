import { parsePromptPublicId } from "@/lib/prompt-presets/contracts";
import {
  assertNoForbiddenPromptQuery,
  normalizePromptValue,
  optionalExpectedRevision,
  promptApiError,
  promptError,
  promptJson,
  readOptionalPromptJson,
  readPromptJson,
  requireExpectedRevision,
  requirePromptPublicId,
} from "@/lib/prompt-presets/http";
import {
  deletePromptForUser,
  updatePromptForUser,
} from "@/lib/prompt-presets/repository";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";

type Context = { params: { presetId: string } };

export async function PATCH(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return promptError("请先登录", 401);

  try {
    assertNoForbiddenPromptQuery(req);
    const publicId = requirePromptPublicId(params.presetId);
    const body = await readPromptJson(req);
    const preset = await updatePromptForUser({
      authUserId,
      publicId,
      expectedRevision: requireExpectedRevision(body.expectedRevision),
      value: normalizePromptValue(body.value),
    });
    return promptJson(preset);
  } catch (error) {
    return promptApiError(error);
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return promptError("请先登录", 401);

  try {
    assertNoForbiddenPromptQuery(req);
    const publicId = requirePromptPublicId(params.presetId);
    const { source } = parsePromptPublicId(publicId);
    const body = await readOptionalPromptJson(req);
    const expectedRevision =
      source === "custom"
        ? requireExpectedRevision(body.expectedRevision)
        : optionalExpectedRevision(body.expectedRevision);
    await deletePromptForUser({
      authUserId,
      publicId,
      expectedRevision,
    });
    return promptJson({ ok: true });
  } catch (error) {
    return promptApiError(error);
  }
}
