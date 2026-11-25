import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/materials/page.tsx", "utf8").replace(/\r\n/g, "\n");

describe("materials virtual masonry aspect ratios", () => {
  it("passes the layout ratio into memoized cards", () => {
    expect(source).toContain("const layoutAspectRatio = stableRatio(item);");
    expect(source).toContain("aspectRatio: layoutAspectRatio,");
    expect(source).toContain("visibleCards.map(({ key, id, index, left, top, width, height, aspectRatio })");
    expect(source).toContain("aspectRatio={aspectRatio}");
    expect(source).toContain("aspectRatio: number;");
    expect(source).not.toContain("const aspectRatio = getMaterialAspectRatio(item);");
  });
});
