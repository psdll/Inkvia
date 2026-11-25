import { describe, expect, it } from "vitest";
import { canvasUploadByteLimit, canvasUploadTooLargeMessage, uploadByteLimit } from "@/lib/upload-validation";

describe("canvas upload limits", () => {
  it("accepts film-length sources such as a 333 MB 4K short film and a 67 MB WAV soundtrack", () => {
    expect(canvasUploadByteLimit("video")).toBeGreaterThan(333_365_092);
    expect(canvasUploadByteLimit("audio")).toBeGreaterThan(67_653_292);
    expect(canvasUploadByteLimit("image")).toBeGreaterThanOrEqual(uploadByteLimit("image"));
  });

  it("keeps the shared site-wide defaults for other upload features", () => {
    expect(uploadByteLimit("video")).toBe(200 * 1024 * 1024);
    expect(uploadByteLimit("audio")).toBe(50 * 1024 * 1024);
  });

  it("explains an oversized canvas file in Chinese", () => {
    expect(canvasUploadTooLargeMessage("video")).toBe("视频超过 2GB，请压缩后再上传");
    expect(canvasUploadTooLargeMessage("audio")).toBe("音频超过 500MB，请压缩后再上传");
  });
});
