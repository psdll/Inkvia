import { describe, expect, it } from "vitest";
import { selectLatestSuccessfulLiveVideoOutputs } from "@/lib/live-video-batch/download-selection";

describe("selectLatestSuccessfulLiveVideoOutputs", () => {
  it("selects the latest successful MP4 attempt for each item", () => {
    const items = [
      {
        id: "item-1",
        outputs: [
          { id: "old", attempt: 1, status: "success", generation: { localPath: "/uploads/video/old.mp4" } },
          { id: "latest", attempt: 2, status: "success", generation: { localPath: "/uploads/video/latest.mp4" } },
        ],
      },
      {
        id: "item-2",
        outputs: [
          { id: "failed", attempt: 2, status: "failed", generation: null },
          { id: "last-success", attempt: 1, status: "success", generation: { localPath: "/uploads/video/ok.mp4" } },
        ],
      },
    ];

    expect(
      selectLatestSuccessfulLiveVideoOutputs(items).map(({ output }) => output.id),
    ).toEqual(["latest", "last-success"]);
  });

  it("ignores non-MP4 and missing local outputs", () => {
    const items = [
      {
        id: "item-1",
        outputs: [
          { id: "webm", attempt: 1, status: "success", generation: { localPath: "/uploads/video/result.webm" } },
          { id: "remote-only", attempt: 2, status: "success", generation: { localPath: null } },
        ],
      },
    ];

    expect(selectLatestSuccessfulLiveVideoOutputs(items)).toEqual([]);
  });
});
