import type { CanvasViewport } from "@/lib/canvas/document";
import { CANVAS_MIN_ZOOM } from "@/lib/canvas/visual-policy";

type Bounds = { x: number; y: number; width: number; height: number };

/** Focus the node itself; source resolution and generation status do not affect framing. */
export function getCanvasNodeFocusViewport(bounds: Bounds, viewport: { width: number; height: number }, topInset = 0): CanvasViewport | null {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, viewport.width, viewport.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;

  const padding = 56;
  const toolbarSpace = Math.max(0, topInset);
  const zoom = Math.max(CANVAS_MIN_ZOOM, Math.min(
    2,
    Math.max(1, viewport.width - padding * 2) / bounds.width,
    Math.max(1, viewport.height - padding * 2 - toolbarSpace) / bounds.height,
  ));
  return {
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: (viewport.height + toolbarSpace) / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}
