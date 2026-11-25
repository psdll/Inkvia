import { describe, expect, it } from "vitest";
import {
  canStartBatchTaskAction,
  isActiveBatchOutputStatus,
  resolveFailedTaskAction,
} from "@/components/batch-workbench/task-action-mode";

describe("batch task action decisions", () => {
  it.each(["queued", "submitting", "waiting_provider", "running", "processing"])(
    "treats %s as active",
    (status) => expect(isActiveBatchOutputStatus(status)).toBe(true),
  );

  it.each(["draft", "success", "failed", "cancelled", null, undefined])(
    "treats %s as inactive",
    (status) => expect(isActiveBatchOutputStatus(status)).toBe(false),
  );

  it("submits current inputs when a failed task was edited", () => {
    expect(resolveFailedTaskAction({ itemStatus: "failed", hasPendingChanges: true })).toBe("submit");
    expect(resolveFailedTaskAction({ itemStatus: "draft", hasPendingChanges: false })).toBe("submit");
  });

  it("reuses the failed snapshot when no generation input changed", () => {
    expect(resolveFailedTaskAction({ itemStatus: "failed", hasPendingChanges: false })).toBe("retry");
  });

  it("allows a failed item to retry while a sibling item is still active", () => {
    expect(canStartBatchTaskAction({
      action: "retry",
      batchActive: true,
      itemOutputStatus: "failed",
      itemPending: false,
      batchSubmitting: false,
    })).toBe(true);
  });

  it("allows a completed item to regenerate while a sibling item is still active", () => {
    expect(canStartBatchTaskAction({
      action: "regenerate",
      batchActive: true,
      itemOutputStatus: "success",
      itemPending: false,
      batchSubmitting: false,
    })).toBe(true);
  });

  it("blocks repeated item actions while the same item or output is active", () => {
    expect(canStartBatchTaskAction({
      action: "retry",
      batchActive: true,
      itemOutputStatus: "queued",
      itemPending: false,
      batchSubmitting: false,
    })).toBe(false);
    expect(canStartBatchTaskAction({
      action: "retry",
      batchActive: false,
      itemOutputStatus: "failed",
      itemPending: true,
      batchSubmitting: false,
    })).toBe(false);
  });
});
