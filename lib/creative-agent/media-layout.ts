import type { CanvasDocumentV2, CanvasNode } from "@/lib/canvas/document";
import { getCanvasMediaNodeSize } from "@/lib/canvas/media-size";
import { getCanvasLocalUploadPositions } from "@/lib/canvas/material-placement";
import { fitCanvasGroupBounds } from "@/lib/canvas/group-layout";

export function isCreativeAgentMediaPlaceholder({ data, width, height }: Pick<CanvasNode, "data" | "width" | "height">) {
  return (data.kind === "image" || data.kind === "video") && data.origin === "generated" && Boolean(data.mediaId)
    && /^Agent (图片|视频) · \d+$/.test(data.name || "")
    && width === 360 && height === (data.kind === "image" ? 360 : 203);
}

/** Repair only Agent placeholders, preserving manually resized media and other nodes. */
export function restoreCreativeAgentMediaSizes(document: CanvasDocumentV2): CanvasDocumentV2 {
  const replacements = new Map(document.nodes.flatMap(node => {
    const data = node.data;
    if ((data.kind !== "image" && data.kind !== "video") || !isCreativeAgentMediaPlaceholder(node)) return [];
    const original = data.variants?.original;
    if (!original?.width || !original.height) return [];
    return [[node.id, { ...node, ...getCanvasMediaNodeSize(original.width, original.height) }] as const];
  }));
  if (!replacements.size) return document;
  const occupied = document.nodes.filter(node => !replacements.has(node.id));
  for (const [id, node] of replacements) {
    // Only move a repaired result if its restored size would overlap artwork.
    const position = node.parentId ? node.position : getCanvasLocalUploadPositions([node], node.position, occupied)[0];
    const next = { ...node, position };
    replacements.set(id, next);
    occupied.push(next);
  }
  const nodes = document.nodes.map(node => replacements.get(node.id) || node);
  const groups = new Set([...replacements.values()].flatMap(node => node.parentId ? [node.parentId] : []));
  return { ...document, nodes: groups.size ? fitCanvasGroupBounds(nodes, groups, true) : nodes };
}
