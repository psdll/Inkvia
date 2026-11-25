import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANVAS_TITLE,
  applyCanvasBrowserTitle,
  normalizeCanvasTitle,
} from "@/lib/canvas/title";

describe("canvas display title", () => {
  it("uses 未命名项目 for empty and legacy default names", () => {
    expect(DEFAULT_CANVAS_TITLE).toBe("未命名项目");
    expect(normalizeCanvasTitle(undefined)).toBe("未命名项目");
    expect(normalizeCanvasTitle("   ")).toBe("未命名项目");
    expect(normalizeCanvasTitle("未命名画布")).toBe("未命名项目");
  });

  it("preserves a renamed canvas title", () => {
    expect(normalizeCanvasTitle("  夏季产品海报  ")).toBe("夏季产品海报");
  });

  it("shows the canvas name in the browser tab", () => {
    const target = { title: "AI 工作室" };

    expect(applyCanvasBrowserTitle("品牌视频方案", target)).toBe("品牌视频方案");
    expect(target.title).toBe("品牌视频方案");
    expect(applyCanvasBrowserTitle("", target)).toBe("未命名项目");
    expect(target.title).toBe("未命名项目");
  });
});
