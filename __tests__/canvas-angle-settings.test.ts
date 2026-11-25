import { describe, expect, it } from "vitest";
import { resolveAngleAspectRatio } from "@/lib/canvas/creative-presets/angle-settings";

const options = ["auto", "1:1", "16:9", "9:16", "3:4"].map(value => ({ value, label: value }));
describe("angle source aspect ratio", () => {
  it("uses real image dimensions for landscape and portrait sources", () => {
    expect(resolveAngleAspectRatio("2048 × 1152", options)).toBe("16:9");
    expect(resolveAngleAspectRatio("1080 × 1440", options)).toBe("3:4");
    expect(resolveAngleAspectRatio("1080 × 1920", options)).toBe("9:16");
  });
  it("preserves nonstandard ratios with auto rather than silently rounding", () => {
    expect(resolveAngleAspectRatio("2752 × 1536", options)).toBe("auto");
  });
  it("only falls back to supported ratios and waits for dimensions when auto is unavailable", () => {
    const fixed = options.filter(option => option.value !== "auto");
    expect(resolveAngleAspectRatio(undefined, fixed)).toBe("");
    expect(resolveAngleAspectRatio("2752 × 1536", fixed)).toBe("16:9");
    expect(resolveAngleAspectRatio("1080 × 1440", fixed.map(option => ({ ...option, disabled: option.value === "3:4" })))).not.toBe("3:4");
  });
});
