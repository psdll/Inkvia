import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/canvas/CanvasNodeCard.tsx"), "utf8");

function branch(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("canvas media double-click canvas focus", () => {
  it.each([
    ["image", 'if (data.kind === "image") {', 'if (data.kind === "video") {'],
    ["video", 'if (data.kind === "video") {', 'if (data.kind === "audio") {'],
  ])("lets the board handle %s double-clicks", (_kind, start, end) => {
    const mediaBranch = branch(start, end);

    expect(mediaBranch).not.toContain("onDoubleClick");
    expect(mediaBranch).not.toContain("editor?.previewMedia(id)");
  });
});
