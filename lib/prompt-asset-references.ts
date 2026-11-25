export type PromptAssetKind = "image" | "video" | "audio";
/** Chip-only kind: a text document referenced in a prompt (no media, shown with a document icon). */
export const PROMPT_TEXT_ASSET_KIND = "text" as unknown as PromptAssetKind;

export type PromptReferenceAsset = {
  id: string;
  token: string;
  kind: PromptAssetKind;
  name?: string;
  url?: string;
  sourceNodeId?: string;
  durationSeconds?: number;
};

export type PromptReferenceResult = {
  displayPrompt: string;
  modelPrompt: string;
  refs: PromptReferenceAsset[];
  mentioned: boolean;
};

export type PromptReferenceOptions = {
  format?: "reference_map" | "ordinal" | "seedance25_mentions" | "apimart_seedance25_mentions" | "wan_mentions";
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export function createPromptAssetMentionPattern(tokens: string[]) {
  const alternatives = tokens.slice().sort((a, b) => b.length - a.length)
    .map((token) => `@${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  return new RegExp(`(${alternatives.join("|")})(?!\\d)`, "g");
}

function assetInputReferenceLabel(asset: PromptReferenceAsset, index: number) {
  const number = asset.token.match(/\d+$/)?.[0] || String(index + 1);
  if (asset.kind === "video") return `第${number}个输入参考视频`;
  if (asset.kind === "audio") return `第${number}段输入参考音频`;
  return `第${number}张输入参考图`;
}

function seedance25AssetMarker(asset: PromptReferenceAsset, index: number) {
  const number = asset.token.match(/\d+$/)?.[0] || String(index + 1);
  return `@${asset.kind}${number}`;
}

export function buildPromptWithAssetReferences(
  prompt: string,
  assets: PromptReferenceAsset[],
  options?: PromptReferenceOptions,
): PromptReferenceResult {
  const displayPrompt = cleanText(prompt);
  const usableAssets = assets.filter((asset) => cleanText(asset.token) && cleanText(asset.url));
  if (!displayPrompt || usableAssets.length === 0) {
    return { displayPrompt, modelPrompt: displayPrompt, refs: [], mentioned: false };
  }

  const byMention = new Map(usableAssets.map((asset, index) => [`@${asset.token}`, { asset, index }]));
  const matchedAssets = new Set<PromptReferenceAsset>();
  const body = displayPrompt.replace(createPromptAssetMentionPattern(usableAssets.map((asset) => asset.token)), (marker) => {
    const { asset, index } = byMention.get(marker)!;
    matchedAssets.add(asset);
    if (options?.format === "apimart_seedance25_mentions") return marker;
    if (options?.format === "wan_mentions") return asset.token.replace(/^图片/, "图");
    return options?.format === "seedance25_mentions" ? seedance25AssetMarker(asset, index) : asset.token;
  });
  const mentionedRefs = usableAssets.filter((asset) => matchedAssets.has(asset));

  if (mentionedRefs.length === 0) {
    return { displayPrompt, modelPrompt: displayPrompt, refs: [], mentioned: false };
  }

  let modelPrompt = body;
  if (!options?.format || options.format === "reference_map") {
    const lines = usableAssets.map((asset, index) => `${asset.token}：${assetInputReferenceLabel(asset, index)}`);
    modelPrompt = `下面是参考素材编号，编号与本次请求中传入的素材顺序一致：\n${lines.join("\n")}\n\n用户需求：\n${body}`.trim();
  }

  return {
    displayPrompt,
    modelPrompt,
    refs: mentionedRefs,
    mentioned: true,
  };
}

export function basenameFromPath(value: unknown) {
  const text = cleanText(value).replaceAll("\\", "/").split("?")[0].split("#")[0];
  if (!text) return "";
  return text.split("/").filter(Boolean).pop() || text;
}

export function inferPromptAssetKind(value: unknown): PromptAssetKind {
  const text = cleanText(value).toLowerCase().split("?")[0].split("#")[0];
  if (/\.(mp4|mov|webm|mkv|m4v|avi)$/.test(text)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(text)) return "audio";
  return "image";
}
