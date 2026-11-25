import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import * as execution from "@/lib/canvas/execution";

type DeduplicationFeature = typeof execution & {
  collapseLegacyVideoResultDuplicates?: (document: CanvasDocumentV2) => CanvasDocumentV2;
};

const feature = execution as DeduplicationFeature;

function videoTask(): CanvasNode {
  return {
    id: "video-task",
    type: "videoTask",
    position: { x: 0, y: 0 },
    data: {
      kind: "videoTask",
      model: "video-model",
      prompt: "prompt",
      mediaPaths: [],
      status: "success",
      generationId: 41,
      outputUrl: "/uploads/result.mp4",
    },
  };
}

describe("canvas video task result deduplication", () => {
  it("keeps the result in the task node and collapses its legacy generated duplicate", () => {
    expect(feature.collapseLegacyVideoResultDuplicates).toBeTypeOf("function");
    if (!feature.collapseLegacyVideoResultDuplicates) return;

    const generatedId = "video-result-video-task-41";
    const document: CanvasDocumentV2 = {
      ...createEmptyCanvasDocumentV2(),
      nodes: [
        videoTask(),
        {
          id: generatedId,
          type: "video",
          position: { x: 360, y: 0 },
          data: { kind: "video", url: "/uploads/result.mp4", name: "视频节点1" },
        },
        {
          id: "downstream",
          type: "prompt",
          position: { x: 720, y: 0 },
          data: { kind: "prompt", text: "downstream" },
        },
      ],
      edges: [
        { id: "auto-edge", source: "video-task", target: generatedId },
        { id: "downstream-edge", source: generatedId, target: "downstream" },
      ],
    };

    const collapsed = feature.collapseLegacyVideoResultDuplicates(document);

    expect(collapsed.nodes.map((node) => node.id)).toEqual(["video-task", "downstream"]);
    expect(collapsed.edges).toEqual([
      { id: "downstream-edge", source: "video-task", target: "downstream" },
    ]);
    expect(feature.collapseLegacyVideoResultDuplicates(collapsed)).toBe(collapsed);
  });

  it("does not collapse image outputs or older video generations", () => {
    expect(feature.collapseLegacyVideoResultDuplicates).toBeTypeOf("function");
    if (!feature.collapseLegacyVideoResultDuplicates) return;

    const document: CanvasDocumentV2 = {
      ...createEmptyCanvasDocumentV2(),
      nodes: [
        videoTask(),
        {
          id: "video-result-video-task-40",
          type: "video",
          position: { x: 360, y: 0 },
          data: { kind: "video", url: "/uploads/older-result.mp4" },
        },
        {
          id: "image-result-image-task-41",
          type: "image",
          position: { x: 720, y: 0 },
          data: { kind: "image", url: "/uploads/result.jpg" },
        },
      ],
    };

    expect(feature.collapseLegacyVideoResultDuplicates(document)).toBe(document);
  });

  it("does not create a second media node when a video task succeeds", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

    expect(board).not.toContain('addGeneratedMedia(nodeId, "video", url, `video-result-${nodeId}-${generationId}`)');
    expect(board).toContain("collapseLegacyVideoResultDuplicates(initial)");
  });
});
