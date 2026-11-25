import { describe, expect, it } from "vitest";
import { buildOrbitCamera, buildOrbitGrid } from "@/components/canvas/creative/angle-orbit";
import { composeCanvasCreativePrompt } from "@/lib/canvas/creative-presets/compose";
import { defaultImageAngle } from "@/lib/canvas/creative-presets/angle";

describe("angle orbit projection", () => {
  it("keeps camera direction, depth and target consistent around the entire sphere", () => {
    for (let azimuth = 0; azimuth < 360; azimuth += 15) for (let elevation = -90; elevation <= 90; elevation += 15) {
      const camera = buildOrbitCamera({ ...defaultImageAngle, azimuth, elevation });
      expect(Number.isFinite(camera.x + camera.y + camera.depth)).toBe(true);
      expect(Math.hypot(camera.lens.x - 120, camera.lens.y - 120)).toBeLessThanOrEqual(Math.hypot(camera.x - 120, camera.y - 120) + 1e-8);
      for (const face of camera.faces) expect(face.points).not.toMatch(/NaN|Infinity/);
    }
    const camera = (azimuth: number, elevation = 0) => buildOrbitCamera({ ...defaultImageAngle, azimuth, elevation });
    expect(camera(0).depth).toBeGreaterThan(0); expect(camera(180).depth).toBeLessThan(0);
    expect(camera(90).x).toBeGreaterThan(120); expect(camera(270).x).toBeLessThan(120);
    expect(camera(0, 60).y).toBeLessThan(120); expect(camera(0, -60).y).toBeGreaterThan(120);
    expect(camera(0).rearVisible).toBe(true); expect(camera(180).rearVisible).toBe(false);
  });
  it("rotates the grid instead of changing unrelated two-dimensional ellipses", () => {
    const initial = buildOrbitGrid();
    const tilted = buildOrbitGrid(45, -30);
    expect(tilted.front).not.toBe(initial.front); expect(tilted.back).not.toBe(initial.back);
    expect(tilted.front + tilted.back).not.toMatch(/NaN|Infinity/);
  });
  it("keeps the camera position and size fixed while changing shot scale", () => {
    const angle = { ...defaultImageAngle, azimuth: 45, elevation: 30 };
    expect(buildOrbitCamera({ ...angle, zoom: 0 })).toEqual(buildOrbitCamera({ ...angle, zoom: 10 }));
  });
  it.each([-90, -75, 75, 90])("preserves elevation %s through backend prompt validation", elevation => {
    const result = composeCanvasCreativePrompt({ kind: "image", prompt: "", imageAngle: { ...defaultImageAngle, elevation } });
    expect(result).toContain(`俯仰 ${elevation}°`);
  });
  it.each([-91, 91])("rejects elevation outside the sphere: %s", elevation => {
    expect(() => composeCanvasCreativePrompt({ kind: "image", prompt: "", imageAngle: { ...defaultImageAngle, elevation } })).toThrow();
  });
});
