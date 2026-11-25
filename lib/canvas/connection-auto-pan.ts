import type { ReactFlowState } from "@xyflow/react";
import { calcAutoPan } from "@xyflow/system";

type ConnectionPanState = Pick<ReactFlowState, "domNode" | "autoPanOnConnect" | "autoPanSpeed" | "panBy">;

/** Use XYFlow's single-connection edge distance, speed and viewport constraints. */
export function startCanvasConnectionAutoPan(
  getState: () => ConnectionPanState,
  getPointer: () => { clientX: number; clientY: number } | null,
  onPan: () => void,
) {
  let stopped = false;
  let frame: number | null = null;
  const tick = async () => {
    frame = null;
    if (stopped) return;
    try {
      const state = getState();
      const pointer = getPointer();
      const bounds = state.domNode?.getBoundingClientRect();
      if (state.autoPanOnConnect && pointer && bounds) {
        const [x, y] = calcAutoPan(
          { x: pointer.clientX - bounds.left, y: pointer.clientY - bounds.top },
          bounds,
          state.autoPanSpeed,
        );
        if ((x || y) && await state.panBy({ x, y }) && !stopped) onPan();
      }
    } finally {
      if (!stopped) frame = requestAnimationFrame(tick);
    }
  };
  frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
}
