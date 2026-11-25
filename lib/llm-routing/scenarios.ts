import type { LlmScenario, LlmScenarioId } from "./types";

export const LLM_SCENARIOS: Record<LlmScenarioId, LlmScenario> = {
  "canvas.chat": {
    id: "canvas.chat",
    label: "画布对话",
    settingKey: "llm_route.canvas.chat",
    allowOverride: true,
    visual: false,
    timeoutMs: 120_000,
    logAction: "llm_call_canvas_chat",
  },
  "image.role_prompt": {
    id: "image.role_prompt",
    label: "创作、批量技能",
    settingKey: "llm_route.image.role_prompt",
    allowOverride: false,
    visual: true,
    timeoutMs: 180_000,
    logAction: "llm_call_image_role_prompt",
  },
  "agent.chat": {
    id: "agent.chat",
    label: "Agent 对话",
    settingKey: "llm_route.agent.chat",
    allowOverride: false,
    visual: true,
    timeoutMs: 180_000,
    logAction: "llm_call_agent_chat",
  },
};

export function getLlmScenario(id: LlmScenarioId): LlmScenario {
  return LLM_SCENARIOS[id];
}
