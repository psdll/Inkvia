import type { ReactFlowState } from "@xyflow/react";

export type CanvasViewportContent = "empty" | "visible" | "outside";

/** Use world geometry, including offscreen nodes that have no mounted DOM. */
export function getCanvasViewportContent({ width, height, transform, nodeLookup }: Pick<ReactFlowState, "width" | "height" | "transform" | "nodeLookup">): CanvasViewportContent {
  const [x, y, zoom] = transform;
  if (width <= 0 || height <= 0 || zoom <= 0) return "empty";
  const left = -x / zoom;
  const top = -y / zoom;
  const right = (width - x) / zoom;
  const bottom = (height - y) / zoom;
  let hasNodes = false;
  for (const node of nodeLookup.values()) {
    if (node.hidden) continue;
    const nodeWidth = node.measured.width ?? node.width ?? node.initialWidth ?? 0;
    const nodeHeight = node.measured.height ?? node.height ?? node.initialHeight ?? 0;
    if (nodeWidth <= 0 || nodeHeight <= 0) continue;
    hasNodes = true;
    const position = node.internals.positionAbsolute;
    if (position.x < right && position.x + nodeWidth > left && position.y < bottom && position.y + nodeHeight > top) return "visible";
  }
  return hasNodes ? "outside" : "empty";
}
