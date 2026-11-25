import { describe, expect, it } from "vitest";
import { selectLatestSuccessfulBatchOutputs } from "@/lib/image-batch/download-selection";

describe("image batch download selection", () => {
  it("selects at most one latest successful result for every item slot", () => {
    const items = [
      {
        id: "task-1",
        outputs: [
          { id: "task-1-old", slotIndex: 0, attempt: 1, status: "success", generation: { localPath: "/uploads/old.png" } },
          { id: "task-1-latest", slotIndex: 0, attempt: 2, status: "success", generation: { localPath: "/uploads/latest.png" } },
        ],
      },
      {
        id: "task-2",
        outputs: [
          { id: "task-2-old", slotIndex: 0, attempt: 1, status: "success", generation: { localPath: "/uploads/stale.png" } },
          { id: "task-2-latest", slotIndex: 0, attempt: 2, status: "failed", generation: null },
        ],
      },
      {
        id: "task-3",
        outputs: [
          { id: "task-3-latest", slotIndex: 0, attempt: 3, status: "success", generation: { localPath: "/uploads/third.png" } },
          { id: "task-3-missing", slotIndex: 1, attempt: 1, status: "success", generation: { localPath: null } },
        ],
      },
    ];

    expect(selectLatestSuccessfulBatchOutputs(items).map(({ output }) => output.id)).toEqual([
      "task-1-latest",
      "task-3-latest",
    ]);
  });

  it("is deterministic even when attempts are not pre-sorted", () => {
    const items = [{
      id: "task-1",
      outputs: [
        { id: "latest", slotIndex: 0, attempt: 4, status: "success", generation: { localPath: "/uploads/latest.png" } },
        { id: "old", slotIndex: 0, attempt: 2, status: "success", generation: { localPath: "/uploads/old.png" } },
        { id: "middle", slotIndex: 0, attempt: 3, status: "success", generation: { localPath: "/uploads/middle.png" } },
      ],
    }];

    expect(selectLatestSuccessfulBatchOutputs(items)[0]?.output.id).toBe("latest");
  });
});
