import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
const taskResultStart = source.indexOf("function TaskResultFrame");
const taskResultEnd = source.indexOf("function ImageTaskPanel", taskResultStart);
const taskResultSource = source.slice(taskResultStart, taskResultEnd);
const failedStart = taskResultSource.indexOf(") : failed ? (");
const failedEnd = taskResultSource.indexOf(") : (", failedStart);
const failedSource = taskResultSource.slice(failedStart, failedEnd);

describe("failed canvas task results", () => {
  it("keeps failure feedback non-interactive so the result frame can be dragged", () => {
    expect(failedSource).toContain("data-canvas-task-failure");
    expect(failedSource).not.toContain("<button");
    expect(failedSource).not.toContain("onClick");
    expect(failedSource).not.toContain("nodrag");
    expect(failedSource).not.toContain("点击重试");
    expect(failedSource).not.toContain("runNode(id)");
  });
});
