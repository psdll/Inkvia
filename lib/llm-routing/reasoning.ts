import { isBigModelGlm53 } from "@/lib/bigmodel-llm-models";
// Provider contracts and sources: docs/superpowers/plans/2026-10-15-llm-thinking-controls.md
// Capabilities deliberately do not depend on provider enablement or model visibility.
export const LLM_THINKING_LEVELS = ["default", "none", "low", "medium", "high", "max", "adaptive"] as const;
export type LlmThinkingLevel = typeof LLM_THINKING_LEVELS[number];
// The original Agent stored "off" for its "模型默认" option. Preserve saved runs.
export type LlmThinkingInput = LlmThinkingLevel | "off";
export const LLM_THINKING_LABELS: Record<LlmThinkingLevel, string> = {
  default: "默认", none: "关闭", low: "低", medium: "中", high: "高", max: "最大", adaptive: "自适应",
};
type ThinkingTarget = { providerId: string; modelId: string; protocol?: string };
export type LlmThinkingCapabilities = {
  thinkingLevels: LlmThinkingLevel[];
  thinkingDefault: LlmThinkingLevel;
  reasoningControl: boolean;
};

export function normalizeLlmThinkingLevel(level?: LlmThinkingInput): LlmThinkingLevel {
  return !level || level === "off" ? "default" : level;
}

export function getLlmThinkingCapabilities(target: ThinkingTarget): LlmThinkingCapabilities {
  const { providerId, modelId, protocol = "openai-chat" } = target;
  let levels: LlmThinkingLevel[] = [];
  let thinkingDefault: LlmThinkingLevel = "default";
  if (protocol === "openai-chat") {
    if (isBigModelGlm53(providerId, modelId)) {
      levels = ["low", "high", "max"];
      thinkingDefault = "max";
    } else if ((providerId === "volcengine" && modelId === "doubao-seed-evolving")
      || (providerId === "bailian" && ["qwen3.8-max", "qwen3.8-flash", "qwen3.8-omni-flash"].includes(modelId))) {
      levels = ["none", "low", "medium", "high"];
      thinkingDefault = "high";
    } else if (providerId === "deepseek" && ["deepseek-flash", "deepseek-v4-pro"].includes(modelId)) {
      levels = ["none", "low", "high", "max"];
      thinkingDefault = "high";
    }
  }
  if (providerId === "minimax" && modelId === "MiniMax-M3"
    && ["openai-chat", "anthropic-messages"].includes(protocol)) {
    levels = ["none", "adaptive"];
    thinkingDefault = protocol === "anthropic-messages" ? "none" : "adaptive";
  }
  return { thinkingLevels: ["default", ...levels], thinkingDefault, reasoningControl: levels.length > 0 };
}

export function buildLlmThinkingParams(target: ThinkingTarget, input?: LlmThinkingInput): Record<string, unknown> {
  const level = normalizeLlmThinkingLevel(input);
  if (!getLlmThinkingCapabilities(target).thinkingLevels.includes(level)) {
    throw new Error("当前模型不支持所选思考设置");
  }
  // GLM-5.3 always thinks; preserve reasoning between tool-call rounds.
  // https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
  if (isBigModelGlm53(target.providerId, target.modelId)) {
    return { thinking: { type: "enabled", clear_thinking: false }, ...(level === "default" ? {} : { reasoning_effort: level }) };
  }
  if (level === "default") return {};
  if (target.providerId === "minimax") return { thinking: { type: level === "none" ? "disabled" : "adaptive" } };
  if (target.providerId === "bailian") return { reasoning_effort: level === "high" ? "xhigh" : level };
  return level === "none"
    ? { thinking: { type: "disabled" } }
    : { thinking: { type: "enabled" }, reasoning_effort: level };
}
