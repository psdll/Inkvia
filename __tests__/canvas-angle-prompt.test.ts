import { describe, expect, it } from "vitest";
import { defaultImageAngle, imageAngleDescription, imageAnglePrompt, imageAngleFramingScale } from "@/lib/canvas/creative-presets/angle";

describe("angle control prompt semantics", () => {
  it.each([-15, -14, -1])("describes negative elevation %s as looking upward", elevation => {
    const angle = { ...defaultImageAngle, elevation };
    expect(imageAngleDescription(angle).elevation).toContain("仰");
    expect(imageAnglePrompt(angle).split("\n").find(line => line.startsWith("俯仰 "))).not.toContain("平视");
    expect(imageAnglePrompt(angle)).toContain(`俯仰 ${elevation}°`);
  });
  it.each([1, 14, 15])("describes positive elevation %s as looking downward", elevation => {
    expect(imageAngleDescription({ ...defaultImageAngle, elevation }).elevation).toContain("俯");
  });
  it("does not describe opposite small tilts as the same shot", () => {
    expect(imageAngleDescription({ ...defaultImageAngle, elevation: -5 }).elevation)
      .not.toBe(imageAngleDescription({ ...defaultImageAngle, elevation: 5 }).elevation);
  });
  it.each([[1, "向右环绕 1°"], [38, "向右环绕 38°"], [90, "向右环绕 90°"], [180, "反向环绕 180°"], [270, "向左环绕 90°"], [322, "向左环绕 38°"], [359, "向左环绕 1°"]])("preserves relative direction for azimuth %s", (azimuth, expected) => {
    expect(imageAngleDescription({ ...defaultImageAngle, azimuth: Number(azimuth) }).direction).toContain(expected);
  });
  it("uses the original viewpoint and framing as the unchanged default", () => {
    const description = imageAngleDescription(defaultImageAngle);
    expect(description).toEqual({ direction: "保持原图水平方向", elevation: "保持原图俯仰角度", distance: "原图景别" });
    expect(imageAngleFramingScale(defaultImageAngle)).toBe(1);
    expect(imageAngleFramingScale({ ...defaultImageAngle, zoom: 0 })).toBe(.5);
    expect(imageAngleFramingScale({ ...defaultImageAngle, zoom: 10 })).toBe(2);
    expect(imageAnglePrompt(defaultImageAngle)).not.toContain("0°正面");
    expect(imageAnglePrompt(defaultImageAngle)).toContain("当前拍摄视角为唯一零点");
  });
});
