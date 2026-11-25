import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("video parameter panel outside click", () => {
  it("closes the expanded panel only when the pointer is outside the panel and toggle", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/video/video-tool.tsx"),
      "utf8",
    );
    const frostedSelectSource = readFileSync(
      resolve(process.cwd(), "components/ui/frosted-select.tsx"),
      "utf8",
    );

    expect(source).toContain("videoParamPanelRef");
    expect(source).toContain("videoParamButtonRef");
    expect(source).toContain("videoParamPanelRef.current?.contains(target)");
    expect(source).toContain("videoParamButtonRef.current?.contains(target)");
    expect(source).toContain('target.closest("[data-frosted-select-menu]")');
    expect(frostedSelectSource).toContain("data-frosted-select-menu");
    expect(source).toContain('document.addEventListener("pointerdown", handleVideoParamPointerDown, true)');
    expect(source).toContain('document.removeEventListener("pointerdown", handleVideoParamPointerDown, true)');
    expect(source).toContain("ref={videoParamPanelRef}");
    expect(source).toContain("ref={videoParamButtonRef}");
  });
});
