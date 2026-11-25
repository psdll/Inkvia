import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/materials/page.tsx", "utf8").replace(/\r\n/g, "\n");

describe("materials virtual masonry viewport stability", () => {
  it("measures the masonry relative to the real scroll container", () => {
    expect(source).toContain("scrollContainerRef={scrollAreaRef}");
    expect(source).toContain("scrollContainerRef: React.RefObject<HTMLElement | null>;");
    expect(source).toContain("scrollNode.scrollTop + nodeRect.top - scrollRect.top");
    expect(source).not.toContain("setContainerOffsetTop(node.offsetTop)");
  });

  it("remeasures after the tab becomes visible", () => {
    expect(source).toContain('document.addEventListener("visibilitychange", handleVisibilityChange);');
    expect(source).toContain('document.removeEventListener("visibilitychange", handleVisibilityChange);');
    expect(source).toContain('if (document.visibilityState === "visible") update();');
  });
});
