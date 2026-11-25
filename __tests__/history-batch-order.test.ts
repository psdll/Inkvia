import { describe, expect, it } from "vitest";
import {
  compareHistoryDisplayGroupItems,
  getHistoryDisplayGroupKey,
  isSameSubmissionBatchTask,
  shouldKeepSubmissionBatchPlaceholder,
  sortHistoryBySubmissionOrder,
} from "@/lib/history-batch-order";

describe("history batch ordering", () => {
  it("keeps one batch in submission order even when later tasks finish first", () => {
    const ordered = sortHistoryBySubmissionOrder([
      {
        id: "2",
        createdAt: "2026-07-10T09:00:00.000Z",
        params: { batch: { id: "batch-a", index: 2, size: 2 } },
      },
      {
        id: "1",
        createdAt: "2026-07-10T09:00:01.000Z",
        params: { batch: { id: "batch-a", index: 1, size: 2 } },
      },
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("keeps non-batch history ordered by its existing creation-time rule", () => {
    const ordered = sortHistoryBySubmissionOrder([
      { id: "old", createdAt: "2026-07-10T09:00:00.000Z" },
      { id: "new", createdAt: "2026-07-10T09:01:00.000Z" },
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("matches a local placeholder to its persisted batch task", () => {
    expect(isSameSubmissionBatchTask(
      { id: "temp", createdAt: "2026-07-10T09:00:00.000Z", batchId: "batch-a", batchIndex: 2 },
      { id: "42", createdAt: "2026-07-10T09:00:01.000Z", params: { batch: { id: "batch-a", index: 2, size: 2 } } },
    )).toBe(true);
  });

  it("matches a single-task placeholder to its persisted request key", () => {
    expect(isSameSubmissionBatchTask(
      { id: "temp", createdAt: "2026-07-10T09:00:00.500Z", requestKey: "request-a" },
      { id: "42", createdAt: "2026-07-10T09:00:00.000Z", requestKey: "request-a" },
    )).toBe(true);
  });

  it("does not match unrelated tasks by their timestamps", () => {
    expect(isSameSubmissionBatchTask(
      { id: "temp", createdAt: "2026-07-10T09:00:00.500Z", requestKey: "request-a" },
      { id: "42", createdAt: "2026-07-10T09:00:00.000Z", requestKey: "request-b" },
    )).toBe(false);
  });

  it("keeps unmatched batch placeholders while another task from the batch is already visible", () => {
    const pending = { id: "temp-2", createdAt: "2026-07-10T09:00:00.000Z", batchId: "batch-a", batchIndex: 2 };
    const visible = [{ id: "1", createdAt: "2026-07-10T09:00:01.000Z", params: { batch: { id: "batch-a", index: 1, size: 2 } } }];

    expect(shouldKeepSubmissionBatchPlaceholder(pending, visible)).toBe(true);
  });

  it("keeps only unmatched request-key placeholders", () => {
    const pending = { id: "temp", createdAt: "2026-07-10T09:00:00.000Z", requestKey: "request-a" };
    const other = { id: "41", createdAt: "2026-07-10T09:00:01.000Z", requestKey: "request-b" };
    const match = { id: "42", createdAt: "2026-07-10T09:00:02.000Z", requestKey: "request-a" };

    expect(shouldKeepSubmissionBatchPlaceholder(pending, [other])).toBe(true);
    expect(shouldKeepSubmissionBatchPlaceholder(pending, [other, match])).toBe(false);
  });

  it("keeps batch cards contiguous when task creation timestamps differ", () => {
    const ordered = sortHistoryBySubmissionOrder([
      { id: "a-1", createdAt: "2026-07-10T09:00:10.000Z", params: { batch: { id: "batch-a", index: 1, size: 2, submittedAt: "2026-07-10T09:00:00.000Z" } } },
      { id: "b", createdAt: "2026-07-10T09:00:05.000Z" },
      { id: "a-2", createdAt: "2026-07-10T09:00:00.000Z", params: { batch: { id: "batch-a", index: 2, size: 2, submittedAt: "2026-07-10T09:00:00.000Z" } } },
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["b", "a-1", "a-2"]);
  });

  it("groups pending, failed, and persisted tasks from one quantity batch together", () => {
    const pending = {
      id: "temp-a",
      createdAt: "2026-07-13T09:00:00.000Z",
      batchId: "quantity-a",
      batchIndex: 1,
      batchSize: 3,
      externalTaskId: null,
    };
    const failed = {
      id: "42",
      createdAt: "2026-07-13T09:00:01.000Z",
      externalTaskId: "provider-task-2",
      params: { batch: { id: "quantity-a", index: 2, size: 3 } },
    };
    const success = {
      id: "43",
      createdAt: "2026-07-13T09:00:02.000Z",
      externalTaskId: "provider-task-3",
      params: { batch: { id: "quantity-a", index: 3, size: 3 } },
    };

    expect(getHistoryDisplayGroupKey(pending)).toBe("batch:quantity-a");
    expect(getHistoryDisplayGroupKey(failed)).toBe("batch:quantity-a");
    expect(getHistoryDisplayGroupKey(success)).toBe("batch:quantity-a");
  });

  it("keeps the existing external-task grouping for one-task batches", () => {
    const first = {
      id: "51",
      createdAt: "2026-07-13T09:00:00.000Z",
      externalTaskId: "series-task",
      params: { batch: { id: "quantity-single", index: 1, size: 1 } },
    };
    const second = { ...first, id: "52" };

    expect(getHistoryDisplayGroupKey(first)).toBe("task:series-task");
    expect(getHistoryDisplayGroupKey(second)).toBe("task:series-task");
  });

  it("orders one quantity group by batch index and then output record id", () => {
    const items = [
      { id: "22", createdAt: "2026-07-13T09:00:02.000Z", params: { batch: { id: "quantity-a", index: 2, size: 2 } } },
      { id: "21", createdAt: "2026-07-13T09:00:01.000Z", params: { batch: { id: "quantity-a", index: 2, size: 2 } } },
      { id: "20", createdAt: "2026-07-13T09:00:00.000Z", params: { batch: { id: "quantity-a", index: 1, size: 2 } } },
    ];

    expect(items.sort(compareHistoryDisplayGroupItems).map((item) => item.id)).toEqual(["20", "21", "22"]);
  });
});
