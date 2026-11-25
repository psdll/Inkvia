import type { CanvasNode } from "./document";
import { canvasNodeWorldPosition } from "./spatial-index";
import { DEFAULT_CANVAS_MEDIA_NODE_SIZE } from "./media-size";

export const CANVAS_LOCAL_UPLOAD_GAP = 150;

export function getCanvasLocalUploadPositions(
  sizes: Array<{ width: number; height: number }>,
  origin: { x: number; y: number },
  occupiedNodes: CanvasNode[] = [],
) {
  if (!sizes.length) return [];
  const width = sizes.reduce((sum, size) => sum + size.width, 0) + CANVAS_LOCAL_UPLOAD_GAP * (sizes.length - 1);
  const height = Math.max(...sizes.map(size => size.height));
  const byId = new Map(occupiedNodes.map(node => [node.id, node]));
  const bounds = occupiedNodes.map(node => ({
    ...canvasNodeWorldPosition(node, byId),
    width: node.width ?? DEFAULT_CANVAS_MEDIA_NODE_SIZE.width,
    height: node.height ?? DEFAULT_CANVAS_MEDIA_NODE_SIZE.height,
  }));
  // Keep the batch together. Try free space to the right and below the requested
  // location, choosing the shorter move without rearranging existing artwork.
  const findSpace = (axis: "x" | "y") => {
    const point = { ...origin };
    for (let pass = 0; pass <= bounds.length; pass += 1) {
      const collisions = bounds.filter(rect => point.x < rect.x + rect.width + CANVAS_LOCAL_UPLOAD_GAP
        && point.x + width + CANVAS_LOCAL_UPLOAD_GAP > rect.x
        && point.y < rect.y + rect.height + CANVAS_LOCAL_UPLOAD_GAP
        && point.y + height + CANVAS_LOCAL_UPLOAD_GAP > rect.y);
      if (!collisions.length) return point;
      point[axis] = Math.max(...collisions.map(rect => rect[axis] + (axis === "x" ? rect.width : rect.height) + CANVAS_LOCAL_UPLOAD_GAP));
    }
    return point;
  };
  const right = findSpace("x");
  const below = findSpace("y");
  const start = right.x - origin.x <= below.y - origin.y ? right : below;
  let nextX = start.x;
  return sizes.map((size) => {
    const position = { x: nextX, y: start.y };
    nextX += size.width + CANVAS_LOCAL_UPLOAD_GAP;
    return position;
  });
}
