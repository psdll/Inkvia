import { CANVAS_TASK_BODY_TARGET_HANDLE_ID } from "@/lib/canvas/connection-rules";
import type { CanvasNodeKind } from "@/lib/canvas/document";

type CanvasPoint = { x: number; y: number };
type CanvasRect = { left: number; top: number; width: number; height: number };
type CanvasViewportTransform = readonly [x: number, y: number, zoom: number];

const CANVAS_CONNECTION_TARGET_MAX_TILT = 8;

export type CanvasConnectionCandidateState = "valid" | "invalid" | null;
export type CanvasConnectionFeedbackTarget = {
  nodeId: string;
  state: Exclude<CanvasConnectionCandidateState, null>;
} | null;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function resolveCanvasConnectionCandidateState(
  isValid: boolean | null | undefined,
  hasTargetCandidate: boolean,
): CanvasConnectionCandidateState {
  if (!hasTargetCandidate) return null;
  return isValid === true ? "valid" : "invalid";
}

export function resolveCanvasNodeConnectionTargetState(
  nodeId: string,
  xyflowState: CanvasConnectionCandidateState,
  pointerTarget: CanvasConnectionFeedbackTarget,
): CanvasConnectionCandidateState {
  if (!pointerTarget) return xyflowState;
  return pointerTarget.nodeId === nodeId ? pointerTarget.state : null;
}

export function canvasRendererPointToFlowPoint(point: CanvasPoint, transform: CanvasViewportTransform): CanvasPoint {
  const [viewportX, viewportY, zoom] = transform;
  return {
    x: (point.x - viewportX) / zoom,
    y: (point.y - viewportY) / zoom,
  };
}

export function getCanvasConnectionTargetTilt(point: CanvasPoint, rect: CanvasRect) {
  if (rect.width <= 0 || rect.height <= 0) return { rotateX: 0, rotateY: 0 };
  const horizontal = (point.x - (rect.left + rect.width / 2)) / (rect.width / 2);
  const vertical = ((rect.top + rect.height / 2) - point.y) / (rect.height / 2);
  return {
    rotateX: clamp(vertical * CANVAS_CONNECTION_TARGET_MAX_TILT, -CANVAS_CONNECTION_TARGET_MAX_TILT, CANVAS_CONNECTION_TARGET_MAX_TILT),
    rotateY: clamp(horizontal * CANVAS_CONNECTION_TARGET_MAX_TILT, -CANVAS_CONNECTION_TARGET_MAX_TILT, CANVAS_CONNECTION_TARGET_MAX_TILT),
  };
}

const pendingTilts = new Map<HTMLElement, { point: CanvasPoint; frame: number }>();
export function resetCanvasConnectionTargetTilts(root: HTMLElement) {
  for (const element of pendingTilts.keys()) if (root === element || root.contains(element)) resetCanvasConnectionTargetTilt(element);
  root.querySelectorAll<HTMLElement>('[style*="--canvas-target-rotate"]').forEach(resetCanvasConnectionTargetTilt);
  resetCanvasConnectionTargetTilt(root);
}
export function scheduleCanvasConnectionTargetTilt(element: HTMLElement, point: CanvasPoint) {
  const pending = pendingTilts.get(element);
  if (pending) { pending.point = point; return; }
  const update = { point, frame: 0 };
  update.frame = requestAnimationFrame(() => {
    pendingTilts.delete(element);
    if (!element.isConnected) return;
    const tilt = getCanvasConnectionTargetTilt(update.point, element.getBoundingClientRect());
    element.style.setProperty("--canvas-target-rotate-x", `${tilt.rotateX}deg`);
    element.style.setProperty("--canvas-target-rotate-y", `${tilt.rotateY}deg`);
  });
  pendingTilts.set(element, update);
}

export function resetCanvasConnectionTargetTilt(element: HTMLElement) {
  const pending = pendingTilts.get(element);
  if (pending) cancelAnimationFrame(pending.frame);
  pendingTilts.delete(element);
  element.style.setProperty("--canvas-target-rotate-x", "0deg");
  element.style.setProperty("--canvas-target-rotate-y", "0deg");
}

export function resolveCanvasConnectionPreviewTarget(
  anchoredTarget: CanvasPoint,
  pointer: CanvasPoint,
  targetHandleId: string | null | undefined,
  targetNodeKind?: CanvasNodeKind | null,
) {
  const taskTarget = targetNodeKind === "imageTask" || targetNodeKind === "videoTask" || targetNodeKind === "llm";
  return targetHandleId === CANVAS_TASK_BODY_TARGET_HANDLE_ID || taskTarget ? pointer : anchoredTarget;
}
