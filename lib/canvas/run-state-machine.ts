export const CANVAS_RUN_STEP_STATUSES = [
  "queued",
  "leased",
  "submitting",
  "waiting_provider",
  "applying",
  "success",
  "failed",
  "retry_wait",
  "submission_unknown",
  "cancel_requested",
  "cancelled",
] as const;

export type CanvasRunStepStatus = typeof CANVAS_RUN_STEP_STATUSES[number];

const TRANSITIONS: Record<CanvasRunStepStatus, ReadonlySet<CanvasRunStepStatus>> = {
  queued: new Set(["leased", "cancel_requested"]),
  leased: new Set(["queued", "submitting", "cancel_requested"]),
  submitting: new Set(["waiting_provider", "submission_unknown", "failed", "cancel_requested"]),
  waiting_provider: new Set(["applying", "retry_wait", "failed", "cancel_requested"]),
  applying: new Set(["success", "failed", "cancel_requested"]),
  success: new Set(),
  failed: new Set(),
  retry_wait: new Set(["queued", "cancel_requested"]),
  submission_unknown: new Set(["waiting_provider", "applying", "success", "failed", "cancel_requested"]),
  cancel_requested: new Set(["cancelled"]),
  cancelled: new Set(),
};

export function assertCanvasRunStepTransition(from: CanvasRunStepStatus, to: CanvasRunStepStatus) {
  if (from === to) return;
  if (!TRANSITIONS[from].has(to)) throw new Error(`RUN_STEP_INVALID_TRANSITION: ${from} -> ${to}`);
}
export function recoverCanvasRunStepStatus(status: CanvasRunStepStatus): CanvasRunStepStatus {
  if (status === "leased") return "queued";
  if (status === "submitting") return "submission_unknown";
  return status;
}
