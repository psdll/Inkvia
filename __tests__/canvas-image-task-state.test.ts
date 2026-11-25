import { describe, expect, it } from "vitest";
import {
  canvasElapsedSeconds,
  clampCanvasTaskCount,
  createCanvasTaskOutputs,
  getCanvasImageDisplayCount,
  getCanvasImageModelParams,
  getCanvasImageRequestCount,
  getCanvasImageSubmissionResolution,
  parseCanvasAspectRatio,
} from "@/lib/canvas/image-task";
import {
  APIMART_MIDJOURNEY_V8_MODEL_ID,
  MIDJOURNEY_V8_MODEL_ID,
  MIDJOURNEY_V8_RATIOS,
} from "@/lib/midjourney-v8";

describe("canvas image task state", () => {
  it("clamps generation count to one through eight and creates matching slots", () => {
    expect(clampCanvasTaskCount(0)).toBe(1);
    expect(clampCanvasTaskCount(9)).toBe(8);
    expect(createCanvasTaskOutputs(3, (() => { let id = 0; return () => String(++id); })())).toHaveLength(3);
  });

  it("derives elapsed seconds without persisted timer updates", () => {
    expect(canvasElapsedSeconds(1_000, 19_999)).toBe(18);
    expect(canvasElapsedSeconds(undefined, 19_999)).toBe(0);
  });

  it("maps model-specific ratios, resolutions and optional quality", () => {
    const official = getCanvasImageModelParams("gpt-image-2-official-reapi");
    expect(official.qualities.map((item) => item.value)).toEqual(["low", "medium", "high"]);
    expect(official.defaultQuality).toBe("medium");
    const lite = getCanvasImageModelParams("nano-banana-2-lite");
    expect(lite.resolutions.map((item) => item.value)).toEqual(["1K"]);
    const midjourney = getCanvasImageModelParams(MIDJOURNEY_V8_MODEL_ID);
    expect(midjourney.aspectRatios.map((item) => item.value)).toEqual(MIDJOURNEY_V8_RATIOS);
    expect(midjourney.resolutions).toEqual([{ value: "auto", label: "自适应" }]);
    expect(midjourney.defaultResolution).toBe("auto");
    expect(midjourney.qualities).toEqual([]);
  });

  it("shows Midjourney's fixed four outputs while keeping one provider request", () => {
    expect(getCanvasImageDisplayCount(APIMART_MIDJOURNEY_V8_MODEL_ID, 1)).toBe(4);
    expect(getCanvasImageRequestCount(APIMART_MIDJOURNEY_V8_MODEL_ID, 4)).toBe(1);
    expect(getCanvasImageSubmissionResolution(APIMART_MIDJOURNEY_V8_MODEL_ID, "2K")).toBeUndefined();
    expect(getCanvasImageDisplayCount("nano-banana-pro", 2)).toBe(2);
    expect(getCanvasImageRequestCount("nano-banana-pro", 2)).toBe(2);
    expect(getCanvasImageSubmissionResolution("nano-banana-pro", "2K")).toBe("2K");
  });

  it("uses the source ratio for auto placeholders", () => {
    expect(parseCanvasAspectRatio("auto", 3 / 4)).toBe(3 / 4);
    expect(parseCanvasAspectRatio("16:9")).toBeCloseTo(16 / 9);
  });
});
