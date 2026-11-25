import prisma from "@/lib/prisma";
import { getRegisteredProviders } from "@/lib/providers/registry";

const SETTING_KEY = "llm_model_visibility";
const DISPLAY_NAMES_SETTING_KEY = "llm_model_display_names";

// The same model can be offered by several providers independently.
export function llmVisibilityKey(providerId: string, modelId: string) {
  return `llm:${JSON.stringify([providerId, modelId])}`;
}

export function isLlmModelVisible(visibility: Record<string, boolean>, providerId: string, modelId: string) {
  return visibility[llmVisibilityKey(providerId, modelId)] !== false;
}

export function getLlmModelDisplayName(displayNames: Record<string, string>, providerId: string, modelId: string) {
  return displayNames[llmVisibilityKey(providerId, modelId)] || modelId;
}

export async function getLlmModelDisplayNames(): Promise<Record<string, string>> {
  const row = await prisma.appSetting.findUnique({ where: { key: DISPLAY_NAMES_SETTING_KEY } });
  try {
    const value = JSON.parse(row?.value || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter((entry): entry is [string, string] => entry[0].startsWith("llm:") && typeof entry[1] === "string" && !!entry[1].trim())
      .map(([key, name]) => [key, name.trim()]));
  } catch {
    return {};
  }
}

export async function saveLlmModelDisplayNames(input: Record<string, string>) {
  const [providers, displayNames] = await Promise.all([getRegisteredProviders(), getLlmModelDisplayNames()]);
  let changed = false;
  for (const provider of providers) {
    for (const modelId of provider.chatModels || []) {
      const key = llmVisibilityKey(provider.id, modelId);
      if (typeof input[key] !== "string") continue;
      const name = input[key].trim();
      if (name && name !== modelId) displayNames[key] = name;
      else delete displayNames[key];
      changed = true;
    }
  }
  if (!changed) return;
  const value = JSON.stringify(displayNames);
  await prisma.appSetting.upsert({ where: { key: DISPLAY_NAMES_SETTING_KEY }, create: { key: DISPLAY_NAMES_SETTING_KEY, value }, update: { value } });
}

export async function getLlmModelVisibility(strict = false): Promise<Record<string, boolean>> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  try {
    const value = JSON.parse(row ? row.value : "{}");
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([key, enabled]) => !key.startsWith("llm:") || typeof enabled !== "boolean")) { if (strict) throw new Error("LLM_VISIBILITY_INVALID"); return {}; }
    return Object.fromEntries(Object.entries(value).filter(([key, enabled]) => key.startsWith("llm:") && typeof enabled === "boolean")) as Record<string, boolean>;
  } catch {
    if (strict) throw new Error("LLM_VISIBILITY_INVALID");
    return {};
  }
}

export async function getLlmModelsOverview() {
  const [providers, visibility, displayNames] = await Promise.all([getRegisteredProviders(), getLlmModelVisibility(), getLlmModelDisplayNames()]);
  const models = providers.flatMap((provider) => [...new Set(provider.chatModels || [])].map((modelId) => ({
    id: llmVisibilityKey(provider.id, modelId),
    modelId,
    label: getLlmModelDisplayName(displayNames, provider.id, modelId),
    defaultLabel: modelId,
    provider: provider.id,
    providerName: provider.name,
    category: "llm" as const,
  })));
  return { models, displayNames, visibility: Object.fromEntries(models.map((model) => [model.id, visibility[model.id] !== false])) };
}

export async function saveLlmModelVisibility(input: Record<string, boolean>) {
  const [overview, existing] = await Promise.all([getLlmModelsOverview(), getLlmModelVisibility()]);
  const changes = overview.models.filter((model) => typeof input[model.id] === "boolean");
  if (!changes.length) return;
  const visibility = { ...existing, ...Object.fromEntries(changes.map((model) => [model.id, input[model.id]])) };
  const value = JSON.stringify(visibility);
  await prisma.appSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
}
