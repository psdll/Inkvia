import { expect, it } from "vitest";
import { getReadOnlyProviderModels } from "@/lib/admin/model-display-catalog";
import { getBuiltinProviders } from "@/lib/providers/registry";
import { TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

it("includes MediaKit and future API models without duplicating configured adapters or their aliases", () => {
  const providers = getBuiltinProviders();
  const mediakit = providers.find(provider => provider.id === "volcengine-mediakit")!;
  mediakit.videoModels.push("future-api", "future-api");
  const rows = getReadOnlyProviderModels(providers, TOOLBOX_MODEL_DEFINITIONS);
  const models = rows.filter(row => row.provider === mediakit.id);
  expect(models.map(row => row.modelId)).toEqual(["erase-video-subtitle-pro-v5", "future-api"]);
  expect(models.every(row => row.visibilityControl === false)).toBe(true);
  expect(rows.some(row => row.modelId === "qwen-image-3.0-pro")).toBe(false);
  expect(rows.some(row => row.modelId === "gemini-3-pro-image")).toBe(false);
  expect(rows.some(row => row.category as string === "llm")).toBe(false);
});
