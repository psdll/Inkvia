import type { PromptReferenceAsset } from "@/lib/prompt-asset-references";
import type { GptImage25VariantOptions } from "@/lib/gpt-image-25-models";

export type BatchSettings = {
  schemaVersion?: number;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  gptImage25Mode?: string;
  background?: string;
  googleThinkingLevel?: string;
  googleSearchMode?: string;
  outputFormat?: string;
  gifSize?: string;
  frameCount?: number;
  frameDurationMs?: number; customSize?: string; seedream55?: import("@/lib/apimart-seedream-55").Seedream55Settings;
};

export type BatchMediaAsset = {
  id: string;
  originalName?: string | null;
  originalKey?: string | null;
  publicUrl?: string | null;
};

export type BatchMediaRelation = {
  id: string;
  itemId: string | null;
  role: "product" | "reference" | "additional_reference";
  position: number;
  media: BatchMediaAsset;
  pending?: boolean;
};

export type BatchGeneration = {
  model?: string | null;
  id: number;
  status: string | null;
  localPath: string | null;
  errorMsg: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type BatchOutput = {
  id: string;
  slotIndex: number;
  attempt: number;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  generation?: BatchGeneration | null;
};

export type BatchItem = {
  id: string;
  groupId?: string | null;
  position: number;
  name: string;
  prompt: string;
  includeSharedPrompt: boolean;
  overrides: BatchSettings;
  outputCount: number;
  status: string;
  media: BatchMediaRelation[];
  outputs: BatchOutput[];
};

export type BatchGroup = {
  id: string;
  position: number;
  sequence?: number | null;
  name: string;
};

export type BatchHistoryGroup = BatchGroup & {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  batch: {
    id: string;
    mode: ImageBatch["mode"];
    status: string;
    sharedSettings: BatchSettings;
    version: number;
    submittedAt?: string | null;
    finishedAt?: string | null;
    updatedAt: string;
  };
  items: BatchItem[];
};

export type ImageBatch = {
  id: string;
  name: string;
  mode: "style_replication" | "multi_prompt";
  status: string;
  sharedPrompt: string;
  sharedSettings: BatchSettings;
  version: number;
  submittedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
  groups: BatchGroup[];
  items: BatchItem[];
  media: BatchMediaRelation[];
};

export type ImageBatchListItem = Pick<
  ImageBatch,
  "id" | "name" | "mode" | "status" | "version" | "submittedAt" | "finishedAt" | "updatedAt"
> & { _count?: { groups: number; items: number; outputs: number } };

export type ImageEditModel = GptImage25VariantOptions & {
  id: string;
  label: string;
  provider?: string;
};

export function latestBatchOutputs(outputs: BatchOutput[]) {
  const latest = new Map<number, BatchOutput>();
  for (const output of outputs) {
    const current = latest.get(output.slotIndex);
    if (!current || output.attempt > current.attempt) latest.set(output.slotIndex, output);
  }
  return Array.from(latest.values()).sort((a, b) => a.slotIndex - b.slotIndex);
}

export type BatchGroupResultPreviewEntry = {
  itemId: string;
  outputId: string;
  src: string;
};

export type BatchGroupResultPreview = {
  entries: BatchGroupResultPreviewEntry[];
  initialIndex: number;
};

export function buildBatchGroupResultPreview(
  items: BatchItem[],
  selectedOutputId: string,
): BatchGroupResultPreview | null {
  const entries = items.flatMap<BatchGroupResultPreviewEntry>((item) => {
    const output = latestBatchOutputs(item.outputs || [])[0];
    const src = output?.generation?.localPath;
    return output && src
      ? [{ itemId: item.id, outputId: output.id, src }]
      : [];
  });
  const initialIndex = entries.findIndex(
    (entry) => entry.outputId === selectedOutputId,
  );

  return initialIndex >= 0 ? { entries, initialIndex } : null;
}

export function relationPreviewUrl(relation: BatchMediaRelation | null | undefined) {
  return relation?.media.originalKey || relation?.media.publicUrl || "";
}

export function buildBatchPromptAssets(
  media: BatchMediaRelation[],
): PromptReferenceAsset[] {
  const assets: PromptReferenceAsset[] = [];
  for (const relation of [...media].sort((left, right) => left.position - right.position)) {
    const url = relationPreviewUrl(relation);
    if (!url) continue;
    const number = assets.length + 1;
    assets.push({
      id: `batch-product-${relation.id}`,
      token: `图片${number}`,
      kind: "image",
      url,
      name: relation.media.originalName || `产品图${number}`,
    });
  }
  return assets;
}
