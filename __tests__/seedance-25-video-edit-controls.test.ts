import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

describe("Seedance 2.5 video-edit controls", () => {
  it("renders a static adaptive ratio and hides duration only for video editing", () => {
    const source = readFileSync("app/video/video-tool.tsx", "utf8");

    expect(source).toContain(
      'const isSeedance25VideoEdit = isSeedance25 && omniReferenceTaskType === "edit";',
    );
    expect(source).toContain("data-seedance-video-edit-ratio-static");
    expect(source).toContain('aria-label="宽高比：自适应"');
    expect(source).toContain("{!isSeedance25VideoEdit && (useDurationSlider ? (");
  });
});
