import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { IMAGE_EDIT_AGENT_SYSTEM_PROMPT } from "@/lib/prompts/image-edit-agent";
import { getKieLlmAgentPromptModels } from "@/lib/config";
import { chatJson, getPublicLegacyLlmFailure } from "@/lib/llm";
import { Logger } from "@/lib/logger";
import { getUserId } from "@/lib/server-auth";

// 图片编辑 Agent:把用户的中文编辑意图(可能带图片描述上下文)翻译成
// 一组英文 prompt + negative_prompt,供下游图片生成模型使用。
//
// P2 重构:从直连 OpenRouter 切到 lib/llm (kie.ai claude/gemini),
// JSON mode 走 chatJson,fallback / 错误归一化由 provider 内部完成。

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const authUserId = await getUserId(req);
    if (!authUserId) {
      return NextResponse.json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as any;
    const uid = String(body?.userId || "").trim() || undefined;
    const userInstruction = String(body?.userInstruction || "").trim();
    const context = body?.context ?? null;
    const systemPromptOverride = String(body?.systemPrompt || "").trim();

    if (!userInstruction) {
      return NextResponse.json({ success: false, error: apiMessage("mcf1b269ca413") }, { status: 400 });
    }

    const userPayload = context
      ? JSON.stringify({ instruction: userInstruction, context })
      : userInstruction;
    const systemPrompt = systemPromptOverride || IMAGE_EDIT_AGENT_SYSTEM_PROMPT;

    let result;
    try {
      result = await chatJson(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPayload },
        ],
        {
          models: getKieLlmAgentPromptModels(),
          temperature: 0.4,
          responseFormat: "json_object",
        }
      );
    } catch (e: any) {
      const failure = getPublicLegacyLlmFailure(e, "Agent 模型调用失败，请稍后重试");
      await Logger.api("agent_image_prompt", `Agent 失败:${failure.category}`, "error", Date.now() - startTime, failure.logContext, uid);
      return NextResponse.json({ success: false, error: apiErrorMessage(failure.message) }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
    }

    const parsed = (result.value && typeof result.value === "object") ? (result.value as any) : null;
    const prompt = String(parsed?.prompt || "").trim();
    const negative_prompt = String(parsed?.negative_prompt || "").trim();

    if (!prompt) {
      await Logger.api(
        "agent_image_prompt",
        `LLM 未返回 prompt(${result.model})`,
        "error",
        Date.now() - startTime,
        { model: result.model, raw: result.raw.slice(0, 200) },
        uid,
      );
      return NextResponse.json({ success: false, error: apiMessage("m9ea57334d423") }, { status: 502 });
    }

    await Logger.api(
      "agent_image_prompt",
      `Agent 成功(${result.model})`,
      "success",
      Date.now() - startTime,
      { model: result.model, promptLength: prompt.length, hasNegativePrompt: !!negative_prompt },
      uid,
    );
    return NextResponse.json({ success: true, prompt, negative_prompt });
  } catch (e: any) {
    const failure = getPublicLegacyLlmFailure(e, "Agent 处理失败，请稍后重试");
    await Logger.api("agent_image_prompt", `Agent 异常:${failure.category}`, "error", Date.now() - startTime, failure.logContext);
    return NextResponse.json({ success: false, error: apiErrorMessage(failure.message) }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
}
