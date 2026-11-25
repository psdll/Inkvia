import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateUploadFile } from "@/lib/upload-validation";

function audioFile(bytes: number[], type = "audio/mpeg") {
  const blob = new Blob([Uint8Array.from(bytes)], { type });
  return {
    type,
    size: blob.size,
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start?: number, end?: number) => blob.slice(start, end),
  } as File;
}

describe("canvas audio upload validation", () => {
  it("accepts an audio MIME with a matching signature", async () => {
    const result = await validateUploadFile(audioFile([0x49, 0x44, 0x33, 0x04]), ["audio"]);

    expect(result).toEqual({ ok: true, kind: "audio" });
  });

  it("rejects an audio MIME with forged content", async () => {
    const result = await validateUploadFile(audioFile([0x00, 0x01, 0x02, 0x03]), ["audio"]);

    expect(result.ok).toBe(false);
  });

  it("allows audio through the validated local storage pipeline", () => {
    const localStorage = readFileSync("lib/canvas/media-upload-service.ts", "utf8");
    const uploadRoute = readFileSync("app/api/canvas/upload/route.ts", "utf8");

    expect(uploadRoute).toContain("streamCanvasMediaUpload");
    expect(localStorage).toContain("classifyUploadMime");
    expect(localStorage).toContain("probeCanvasMedia(temporary, input.kind)");
    expect(localStorage).toContain("'local'");
    expect(uploadRoute).not.toContain("DIRECT_UPLOAD_REQUIRED");
  });
});
