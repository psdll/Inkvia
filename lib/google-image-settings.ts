import { GOOGLE_NANO_BANANA_21_MODEL, GOOGLE_NANO_BANANA_21_RATIOS } from "@/lib/google-nano-banana-21";

// Model-specific contracts: https://aistudio.google.com/docs/image-generation (2026-10-09).
export type GoogleImageSettings = { googleThinkingLevel?: string; googleSearchMode?: string };
const thinking = [
  { value: "minimal", label: "低" },
  { value: "medium", label: "标准" },
  { value: "high", label: "高" },
];
const search = [
  { value: "off", label: "关闭" },
  { value: "web", label: "网页" },
  { value: "image", label: "图片" },
  { value: "web_image", label: "网页和图片" },
];
const proRatios = ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
export function getGoogleImageOptions(model: string) {
  switch (model) {
    case GOOGLE_NANO_BANANA_21_MODEL: return { ratios: GOOGLE_NANO_BANANA_21_RATIOS, resolutions: ["1K", "2K", "4K"], thinking, defaultThinking: "medium", search };
    case "gemini-3.1-flash-image": return { ratios: GOOGLE_NANO_BANANA_21_RATIOS, resolutions: ["512", "1K", "2K", "4K"], thinking: thinking.filter(o => o.value !== "medium"), defaultThinking: "minimal", search };
    case "gemini-3.1-flash-lite-image": return { ratios: GOOGLE_NANO_BANANA_21_RATIOS, resolutions: ["1K"], thinking: thinking.filter(o => o.value !== "medium"), defaultThinking: "minimal", search: [] };
    case "gemini-3-pro-image": return { ratios: proRatios, resolutions: ["1K", "2K", "4K"], thinking: [], defaultThinking: "", search: search.slice(0, 2) };
    default: return null;
  }
}

// UI/model changes use supported defaults; submitted values are validated separately.
export function normalizeGoogleImageSettings(model: string, settings: GoogleImageSettings): GoogleImageSettings {
  const options = getGoogleImageOptions(model);
  if (!options) return {};
  return {
    googleThinkingLevel: options.thinking.length ? options.thinking.some(o => o.value === settings.googleThinkingLevel) ? settings.googleThinkingLevel : options.defaultThinking : undefined,
    googleSearchMode: options.search.some(o => o.value === settings.googleSearchMode) ? settings.googleSearchMode : "off",
  };
}

export function validateGoogleImageSettings(model: string, settings: GoogleImageSettings & { aspectRatio?: string; resolution?: string }) {
  const options = getGoogleImageOptions(model);
  if (!options) return;
  if (settings.googleThinkingLevel && !options.thinking.some(o => o.value === settings.googleThinkingLevel)) throw new Error("该 Google 图片模型不支持此画质等级");
  if (settings.googleSearchMode && settings.googleSearchMode !== "off" && !options.search.some(o => o.value === settings.googleSearchMode)) throw new Error("该 Google 图片模型不支持此搜索方式");
  if (settings.aspectRatio && !options.ratios.includes(settings.aspectRatio)) throw new Error("该 Google 图片模型不支持此比例");
  if (settings.resolution && !options.resolutions.includes(settings.resolution)) throw new Error("该 Google 图片模型不支持此分辨率");
}

export type GoogleGrounding = { renderedContent: string; sources: { url: string; title: string }[] };
export function extractGoogleGrounding(raw: any): GoogleGrounding | undefined {
  const metadata = raw?.candidates?.[0]?.groundingMetadata;
  if (!metadata) return undefined;
  const sources: GoogleGrounding["sources"] = [];
  for (const chunk of metadata.groundingChunks || []) {
    const url = String(chunk.image?.sourceUri || chunk.web?.uri || "");
    if (!/^https?:\/\//i.test(url) || sources.some(source => source.url === url)) continue;
    sources.push({ url, title: String(chunk.image?.title || chunk.web?.title || "来源网页") });
  }
  const renderedContent = String(metadata.searchEntryPoint?.renderedContent || "");
  return sources.length || renderedContent ? { renderedContent, sources } : undefined;
}

export function googleImageSettingsSummary(model: string, settings: GoogleImageSettings, label: (source: string) => string = source => source) {
  const options = getGoogleImageOptions(model);
  const selected = normalizeGoogleImageSettings(model, settings);
  return [options?.thinking.find(o => o.value === selected.googleThinkingLevel)?.label,
    selected.googleSearchMode !== "off" ? options?.search.find(o => o.value === selected.googleSearchMode)?.label : ""]
    .flatMap(value => value ? [label(value)] : []).join(" · ");
}
