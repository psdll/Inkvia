import { describe, expect, it } from "vitest";
import { createSubtitleRemovalNode, subtitleRemovalSchema, buildSubtitleRemovalRequest } from "@/lib/canvas/subtitle-removal";
import { canvasNodeSchema, type CanvasNode } from "@/lib/canvas/document";
import { getCanvasTaskPrimaryFrameSize } from "@/lib/canvas/task-references";
import { buildCanvasRunStepSubmission } from "@/lib/canvas/run-worker-contract";

describe("subtitle removal tasks", () => {
  it.each([[1920, 1080], [834, 1112], [1080, 1920]])("keeps %s × %s before and after persistence", (width, height) => {
    const node = createSubtitleRemovalNode("result", "视频_去字幕", "/uploads/source.mp4", { width, height }, { mode: "auto" });
    const saved = canvasNodeSchema.parse(JSON.parse(JSON.stringify(node))) as CanvasNode;
    expect(saved.data).toMatchObject({ kind: "videoTask", status: "running", subtitleRemoval: { mode: "auto" } });
    if (saved.data.kind !== "videoTask") throw new Error("wrong type");
    const frame = getCanvasTaskPrimaryFrameSize(saved.data);
    expect(frame.width / frame.height).toBeCloseTo(width / height, 2);
    expect(buildCanvasRunStepSubmission({ nodeKind: "videoTask", node: saved })).toMatchObject({ kind: "subtitleRemoval", sourceUrl: "/uploads/source.mp4", options: { mode: "auto" } });
  });
  it("validates a bounded region and uses normalized MediaKit coordinates", () => {
    const options = subtitleRemovalSchema.parse({ mode: "region", region: { x: .1, y: .8, width: .8, height: .15 } });
    expect(buildSubtitleRemovalRequest("https://example.com/a.mp4", options)).toMatchObject({ mode: "Text", erase_ratio_location: [{ top_left_x: .1, top_left_y: .8, bottom_right_x: .9, bottom_right_y: .9500000000000001 }] });
    expect(subtitleRemovalSchema.safeParse({ mode: "region" }).success).toBe(false);
    expect(subtitleRemovalSchema.safeParse({ mode: "region", region: { x: .9, y: 0, width: .5, height: 1 } }).success).toBe(false);
    expect(subtitleRemovalSchema.safeParse({ mode: "region", region: { x: 0, y: 0, width: 0, height: 1 } }).success).toBe(false);
  });
});
it("persists separate regions and passes each to the engine without merging their gap", () => {
  const regions = [{ x: .1, y: .1, width: .3, height: .2 }, { x: .5, y: .8, width: .4, height: .1 }];
  const options = subtitleRemovalSchema.parse({ mode: "region", regions });
  const node = createSubtitleRemovalNode("multi", "多区域", "/uploads/source.mp4", { width: 1000, height: 1000 }, options);
  expect((canvasNodeSchema.parse(JSON.parse(JSON.stringify(node))).data as any).subtitleRemoval).toEqual({ mode: "region", regions });
  expect(buildSubtitleRemovalRequest("https://example.com/a.mp4", options).erase_ratio_location).toHaveLength(2);
  expect(subtitleRemovalSchema.safeParse({ mode: "region", regions: Array(21).fill(regions[0]) }).success).toBe(false);
  expect(subtitleRemovalSchema.safeParse({ mode: "region", regions: [] }).success).toBe(false);
  expect(subtitleRemovalSchema.safeParse({ mode: "region", regions: [regions[0], { x: .9, y: 0, width: .2, height: .1 }] }).success).toBe(false);
});
