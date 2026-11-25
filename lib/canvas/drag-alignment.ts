import type { CanvasNode } from "./document";
import { CanvasAlignmentIndex, type CanvasAlignmentRect } from "./alignment-guides";
import { canvasNodeWorldPosition } from "./spatial-index";

/** A drag owns its index; stationary geometry changes invalidate it immediately. */
export function createCanvasDragAlignment(movingIds: ReadonlySet<string>, toRect: (node: CanvasNode) => CanvasAlignmentRect) {
  let previous: readonly CanvasNode[] | undefined;
  let index: CanvasAlignmentIndex | undefined;
  return {
    get(nodes: readonly CanvasNode[]): CanvasAlignmentIndex {
      const unchanged = previous && previous.length === nodes.length && nodes.every((node, i) => {
        const old = previous![i];
        return old === node || (movingIds.has(node.id) && old.id === node.id && old.parentId === node.parentId);
      });
      if (index && unchanged) {
        previous = nodes;
        return index;
      }
      const byId = new Map(nodes.map(node => [node.id, node]));
      const excluded = new Set(movingIds);
      for (const id of movingIds) {
        let parentId = byId.get(id)?.parentId;
        while (parentId && !excluded.has(parentId)) {
          excluded.add(parentId);
          parentId = byId.get(parentId)?.parentId;
        }
      }
      const candidates = nodes.filter(node => {
        if (excluded.has(node.id) || node.hidden) return false;
        const seen = new Set([node.id]);
        let parentId = node.parentId;
        while (parentId && !seen.has(parentId)) {
          if (movingIds.has(parentId)) return false;
          seen.add(parentId);
          parentId = byId.get(parentId)?.parentId;
        }
        return true;
      }).map(node => toRect({ ...node, position: canvasNodeWorldPosition(node, byId) }));
      previous = nodes;
      index = new CanvasAlignmentIndex(candidates);
      return index;
    },
  };
}
