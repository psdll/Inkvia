import { describe, expect, it } from "vitest";
import { getAspectRatioPreviewSize } from "@/lib/aspect-ratio-preview";

describe("aspect ratio preview size", () => {
  it("draws landscape, portrait, and square previews with their real proportions", () => {
    expect(getAspectRatioPreviewSize("1:1", 20)).toEqual({
      width: 20,
      height: 20,
    });
    expect(getAspectRatioPreviewSize("4:3", 20)).toEqual({
      width: 20,
      height: 15,
    });
    expect(getAspectRatioPreviewSize("3:4", 20)).toEqual({
      width: 15,
      height: 20,
    });

    const ultraWide = getAspectRatioPreviewSize("21:9", 20);
    expect(ultraWide.width / ultraWide.height).toBeCloseTo(21 / 9);
  });

  it("keeps adaptive and invalid values as a square fallback", () => {
    expect(getAspectRatioPreviewSize("auto", 14)).toEqual({
      width: 14,
      height: 14,
    });
    expect(getAspectRatioPreviewSize("invalid", 20)).toEqual({
      width: 20,
      height: 20,
    });
  });
});
