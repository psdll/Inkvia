import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("image and video upload comparison removal", () => {
  it("removes comparison selection from the shared upload area", () => {
    const dropzone = readFileSync("components/ui/multi-upload-dropzone.tsx", "utf8");
    const imageTool = readFileSync("app/image/image-tool.tsx", "utf8");
    const videoTool = readFileSync("app/video/video-tool.tsx", "utf8");

    expect(imageTool).toContain("<MultiUploadDropzone");
    expect(videoTool).toContain("<MultiUploadDropzone");
    expect(dropzone).not.toContain("media-compare-lightbox");
    expect(dropzone).not.toContain("MediaCompareLightbox");
    expect(dropzone).not.toContain("compareOpen");
    expect(dropzone).not.toContain("compareSrcs");
    expect(dropzone).not.toContain("toggleSelected");
    expect(dropzone).not.toContain('aria-label="选择"');
    expect(dropzone).not.toContain('className="text-xs">对比</span>');
  });
});
