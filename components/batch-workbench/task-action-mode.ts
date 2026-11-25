const ACTIVE_OUTPUT_STATUSES = new Set([
  "queued",
  "submitting",
  "waiting_provider",
  "running",
  "processing",
]);

export function isActiveBatchOutputStatus(status: string | null | undefined) {
  return ACTIVE_OUTPUT_STATUSES.has(String(status || "").toLowerCase());
}

export function canStartBatchTaskAction(input: {
  action: "retry" | "regenerate";
  batchActive: boolean;
  itemOutputStatus: string | null | undefined;
  itemPending: boolean;
  batchSubmitting: boolean;
}) {
  if (input.itemPending || input.batchSubmitting) return false;
  return !isActiveBatchOutputStatus(input.itemOutputStatus);
}

export function resolveFailedTaskAction(input: {
  itemStatus: string | null | undefined;
  hasPendingChanges: boolean;
}): "submit" | "retry" {
  return input.hasPendingChanges || input.itemStatus === "draft" ? "submit" : "retry";
}
