import { ensureCanvasPromptSeeds } from "@/lib/prompt-presets/builtin-seeds";
import {
  assertNoForbiddenPromptQuery,
  normalizePromptValue,
  promptApiError,
  promptError,
  promptJson,
  readPromptJson,
} from "@/lib/prompt-presets/http";
import {
  ensureLegacyBuiltinPromptsMigrated,
  ensureLegacyUserPromptsMigrated,
} from "@/lib/prompt-presets/migration";
import {
  createCustomPrompt,
  listEffectivePromptPresets,
} from "@/lib/prompt-presets/repository";
import { preparePromptPresetRead } from "@/lib/prompt-presets/read-preparation";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return promptError("请先登录", 401);

  try {
    assertNoForbiddenPromptQuery(req);
    await preparePromptPresetRead([
      {
        name: "legacy-user-migration",
        run: () => ensureLegacyUserPromptsMigrated({
          authUserId,
          presetUserIds: [String(authUserId)],
        }),
      },
      {
        name: "legacy-builtin-migration",
        run: ensureLegacyBuiltinPromptsMigrated,
      },
      { name: "canvas-seeds", run: ensureCanvasPromptSeeds },
    ]);
    return promptJson({
      presets: await listEffectivePromptPresets({ authUserId }),
    });
  } catch (error) {
    return promptApiError(error);
  }
}

export async function POST(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return promptError("请先登录", 401);

  try {
    assertNoForbiddenPromptQuery(req);
    const body = await readPromptJson(req);
    const preset = await createCustomPrompt({
      authUserId,
      value: normalizePromptValue(body),
    });
    return promptJson(preset, 201);
  } catch (error) {
    return promptApiError(error);
  }
}
