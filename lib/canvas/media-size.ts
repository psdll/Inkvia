import type { CanvasDocumentV2 } from "@/lib/canvas/document";

export const DEFAULT_CANVAS_MEDIA_NODE_SIZE = { width: 350, height: 350 } as const;
export const DEFAULT_CANVAS_AUDIO_NODE_SIZE = { width: 420, height: 200 } as const;

export const CANVAS_TASK_PANEL_DEFAULT_WIDTH = 660;

const CANVAS_MEDIA_SHORT_EDGE = 350;
const CANVAS_NATURAL_MEDIA_LONG_EDGE_MAX = 1050;
const CANVAS_RATIO_MEDIA_LONG_EDGE_MAX = 1050;

export function compactCanvasAudioNodeSizes(document: CanvasDocumentV2): CanvasDocumentV2 {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (
      node.data.kind !== "audio"
      || (node.width === DEFAULT_CANVAS_AUDIO_NODE_SIZE.width && node.height === DEFAULT_CANVAS_AUDIO_NODE_SIZE.height)
    ) return node;
    changed = true;
    return { ...node, ...DEFAULT_CANVAS_AUDIO_NODE_SIZE };
  });
  return changed ? { ...document, nodes } : document;
}

export function getCanvasMediaNodeSize(sourceWidth: number, sourceHeight: number) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return DEFAULT_CANVAS_MEDIA_NODE_SIZE;
  }

  const scale = Math.min(
    CANVAS_MEDIA_SHORT_EDGE / Math.min(sourceWidth, sourceHeight),
    CANVAS_NATURAL_MEDIA_LONG_EDGE_MAX / Math.max(sourceWidth, sourceHeight),
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/** Repair only exact legacy default bounds; preserve manually resized materials. */
export function compactCanvasMediaNodeSizes(document: CanvasDocumentV2): CanvasDocumentV2 {
  let changed = false;
  const nodes = document.nodes.map(node => {
    if (node.data.kind !== "image" && node.data.kind !== "video") return node;
    const original = node.data.variants?.original;
    if (!original?.width || !original.height || !Number.isFinite(original.width) || !Number.isFinite(original.height)
      || original.width <= 0 || original.height <= 0) return node;
    const legacyWidth = original.width >= original.height ? Math.min(Math.round(original.width / original.height * CANVAS_MEDIA_SHORT_EDGE), 5600) : CANVAS_MEDIA_SHORT_EDGE;
    const legacyHeight = original.width >= original.height ? CANVAS_MEDIA_SHORT_EDGE : Math.min(Math.round(original.height / original.width * CANVAS_MEDIA_SHORT_EDGE), 5600);
    if (node.width !== legacyWidth || node.height !== legacyHeight) return node;
    const size = getCanvasMediaNodeSize(original.width, original.height);
    if (node.width === size.width && node.height === size.height) return node;
    changed = true;
    return { ...node, ...size };
  });
  return changed ? { ...document, nodes } : document;
}

export function getCanvasRatioMediaNodeSize(sourceWidth: number, sourceHeight: number) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return DEFAULT_CANVAS_MEDIA_NODE_SIZE;
  }

  if (sourceWidth >= sourceHeight) {
    return {
      width: Math.min(Math.round((sourceWidth / sourceHeight) * CANVAS_MEDIA_SHORT_EDGE), CANVAS_RATIO_MEDIA_LONG_EDGE_MAX),
      height: CANVAS_MEDIA_SHORT_EDGE,
    };
  }

  return {
    width: CANVAS_MEDIA_SHORT_EDGE,
    height: Math.min(Math.round((sourceHeight / sourceWidth) * CANVAS_MEDIA_SHORT_EDGE), CANVAS_RATIO_MEDIA_LONG_EDGE_MAX),
  };
}
