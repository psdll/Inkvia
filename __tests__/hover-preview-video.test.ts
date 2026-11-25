import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "components/ui/hover-preview-video.tsx"),
  "utf8",
);

describe("HoverPreviewVideo card marker", () => {
  it("uses a persistent Xiaohongshu-style top-right video badge", () => {
    expect(source).toContain("data-video-badge");
    expect(source).toContain("right-2 top-2");
    expect(source).toContain("<Play");
    expect(source).toContain("h-6 w-6");
    expect(source).not.toMatch(/<Video(?:\s|\/)/);
    expect(source).not.toContain("absolute inset-0 flex items-center justify-center");
  });

  it("exports its card badge for video surfaces that render previews themselves", () => {
    expect(source).toContain("export function VideoBadge");
    expect(source).toContain("data-video-badge");
  });
});
