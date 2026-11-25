import { LLM_THINKING_LEVELS, type LlmThinkingLevel } from "@/lib/llm-routing/reasoning";
import { creativeAgentPreferencesSchema } from "@/lib/creative-agent/schemas";
import type { CreativeAgentPreferences } from "@/lib/creative-agent/preferences";
import { newMatchingPreferences } from "@/lib/creative-agent/matching-contracts";

export type CreationPreferences = {
  model: string;
  thinkingLevel: LlmThinkingLevel;
  media: Pick<CreativeAgentPreferences, "image" | "video">;
};
export const emptyCreationPreferences = (): CreationPreferences => ({ model: "", thinkingLevel: "default", media: newMatchingPreferences() });
export const creationPreferencesKey = (userId: string, canvasId: number, sessionId: string) =>
  userId ? `creative-agent:preferences:v3:${userId}:${canvasId}:${sessionId}` : "";

export function readCreationPreferences(key: string, canvasId: number, sessionId: string): CreationPreferences {
  if (!key) return emptyCreationPreferences();
  try {
    const current = localStorage.getItem(key);
    // Only migrate account-scoped records. Unowned v1 data cannot be safely
    // attributed to the signed-in account without a write during panel opening.
    const legacy = current === null ? localStorage.getItem(key.replace(":v3:", ":v2:")) : null;
    const saved = JSON.parse(current ?? legacy ?? "null");
    if (!saved || typeof saved !== "object") return emptyCreationPreferences();
    const media = creativeAgentPreferencesSchema.safeParse(saved.media ?? {});
    if (!media.success) return emptyCreationPreferences();
    const result: CreationPreferences = {
      model: typeof saved.model === "string" ? saved.model : "",
      thinkingLevel: saved.thinkingLevel !== "none" && LLM_THINKING_LEVELS.includes(saved.thinkingLevel) ? saved.thinkingLevel : "default",
      media: newMatchingPreferences(media.data),
    };
    return result;
  } catch { return emptyCreationPreferences(); }
}

export function saveCreationPreferences(key: string, value: CreationPreferences) {
  if (key) try { localStorage.setItem(key, JSON.stringify({ model: value.model, thinkingLevel: value.thinkingLevel, media: newMatchingPreferences(value.media) })); } catch { /* Preferences still apply for this mounted conversation. */ }
}
