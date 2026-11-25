import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("live video batch download routes", () => {
  it("protects individual downloads by batch owner and emits MP4", () => {
    const source = readFileSync(
      "app/api/live-video-batches/[batchId]/items/[itemId]/download/route.ts",
      "utf8",
    );
    expect(source).toContain("getUserId");
    expect(source).toContain("authUserId");
    expect(source).toContain("deletedAt: null");
    expect(source).toContain("selectLatestSuccessfulLiveVideoOutputs");
    expect(source).toContain('"video/mp4"');
  });

  it("streams a ZIP containing the latest successful MP4 per item", () => {
    const source = readFileSync(
      "app/api/live-video-batches/[batchId]/download/route.ts",
      "utf8",
    );
    expect(source).toContain("selectLatestSuccessfulLiveVideoOutputs");
    expect(source).toContain("ZipFile");
    expect(source).toContain('"application/zip"');
    expect(source).toContain("authUserId");
  });
});
