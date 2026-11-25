export type CanvasConnectionHandleType = "source" | "target";
export type CanvasConnectionHandlePoint = { x: number; y: number };

export const CANVAS_CONNECTION_HANDLE_HIT_SIZE = 80;
export const CANVAS_CONNECTION_HANDLE_VISUAL_SIZE = 20;
export const CANVAS_CONNECTION_HANDLE_ACTIVE_SCALE = 1.1;
export const CANVAS_CONNECTION_HANDLE_IDLE_OFFSET = 25;

const CANVAS_CONNECTION_HANDLE_ACTIVE_LIMIT = 30;

export function getCanvasConnectionHandlePointerOffset(
  point: CanvasConnectionHandlePoint,
  rect: { left: number; top: number; width: number; height: number },
): CanvasConnectionHandlePoint {
  return {
    x: point.x - rect.left - rect.width / 2,
    y: point.y - rect.top - rect.height / 2,
  };
}

export function getCanvasConnectionHandleMotion(
  type: CanvasConnectionHandleType,
  pointerOffset: CanvasConnectionHandlePoint | null,
) {
  if (!pointerOffset) {
    return {
      x: type === "source" ? -CANVAS_CONNECTION_HANDLE_IDLE_OFFSET : CANVAS_CONNECTION_HANDLE_IDLE_OFFSET,
      y: 0,
      opacity: 0,
      scale: 1,
    };
  }
  const distance = Math.hypot(pointerOffset.x, pointerOffset.y);
  const ratio = distance > CANVAS_CONNECTION_HANDLE_ACTIVE_LIMIT ? CANVAS_CONNECTION_HANDLE_ACTIVE_LIMIT / distance : 1;
  return {
    x: pointerOffset.x * ratio,
    y: pointerOffset.y * ratio,
    opacity: 1,
    scale: CANVAS_CONNECTION_HANDLE_ACTIVE_SCALE,
  };
}
