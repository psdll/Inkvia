import type { CanvasNodeData } from "@/lib/canvas/document";

const DIMENSION_VARIANT_ORDER = ["original", "preview", "poster", "thumbnail"] as const;

export function formatCanvasMediaResolution(data: CanvasNodeData): string | undefined {
  if (data.kind !== "image" && data.kind !== "video" && data.kind !== "audio") return undefined;
  for (const key of DIMENSION_VARIANT_ORDER) {
    if (data.kind === "image" && key !== "original") continue;
    const variant = data.variants?.[key];
    if (variant?.width && variant.height) return `${variant.width} × ${variant.height}`;
  }
  return undefined;
}

export function hydrateCanvasMediaDimensions(
  data: CanvasNodeData,
  width: number,
  height: number,
): CanvasNodeData {
  if (data.kind !== "image" && data.kind !== "video") return data;
  const nextWidth = Math.round(width);
  const nextHeight = Math.round(height);
  if (nextWidth <= 0 || nextHeight <= 0) return data;
  const original = data.variants?.original;
  if (original?.width === nextWidth && original.height === nextHeight) return data;
  return {
    ...data,
    variants: {
      ...data.variants,
      original: {
        ...original,
        url: original?.url || data.url,
        width: nextWidth,
        height: nextHeight,
      },
    },
  };
}

/** Match the exact output so a late image load cannot resize a replacement or rerun. */
export function hydrateCanvasTaskOutputDimensions(
  data: CanvasNodeData,
  batchId: string,
  outputId: string,
  url: string,
  width: number,
  height: number,
): CanvasNodeData {
  if (data.kind !== "imageTask") return data;
  const nextWidth = Math.round(width), nextHeight = Math.round(height);
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0) return data;
  const output = data.task.batches.find(batch => batch.id === batchId)?.outputs.find(item => item.id === outputId);
  if (!output || output.status !== "success" || output.url !== url || (output.width === nextWidth && output.height === nextHeight)) return data;
  return { ...data, task: { ...data.task, batches: data.task.batches.map(batch => batch.id !== batchId ? batch : {
    ...batch, outputs: batch.outputs.map(item => item.id !== outputId ? item : { ...item, width: nextWidth, height: nextHeight }),
  }) } };
}
