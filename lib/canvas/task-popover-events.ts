"use client";

export const CANVAS_TASK_POPOVER_DISMISS_EVENT = "canvas-dismiss-task-popovers";

export function dismissCanvasTaskPopovers() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CANVAS_TASK_POPOVER_DISMISS_EVENT));
}
