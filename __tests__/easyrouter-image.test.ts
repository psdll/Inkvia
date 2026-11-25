import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EASYROUTER_IMAGE_MODEL_ID,
  buildEasyRouterImageEditRequest,
  buildEasyRouterImageRequest,
  extractEasyRouterImageUrls,
  mapEasyRouterGptImage2Size,
} from "@/lib/easyrouter-image";

describe("EasyRouter Image 2 request mapping", () => {
  it.each([
    ["1K", "1:1", "1024x1024"],
    ["1K", "3:4", "768x1024"],
    ["1K", "4:3", "1024x768"],
    ["1K", "9:16", "720x1280"],
    ["1K", "16:9", "1280x720"],
    ["2K", "1:1", "2048x2048"],
    ["2K", "3:4", "1536x2048"],
    ["2K", "4:3", "2048x1536"],
    ["2K", "9:16", "1152x2048"],
    ["2K", "16:9", "2048x1152"],
    ["4K", "1:1", "2880x2880"],
    ["4K", "3:4", "2448x3264"],
    ["4K", "4:3", "3264x2448"],
    ["4K", "9:16", "2160x3840"],
    ["4K", "16:9", "3840x2160"],
  ])("maps %s %s to %s", (resolution, aspectRatio, expected) => {
    expect(mapEasyRouterGptImage2Size({ aspectRatio, resolution })).toBe(expected);
  });

  it("accepts a custom size inside the GPT-Image-2 limits", () => {
    expect(mapEasyRouterGptImage2Size({ aspectRatio: "custom", customSize: "1280 x 720" })).toBe("1280x720");
  });

  it.each([
    ["1000x1000", "16"],
    ["4096x2048", "3840"],
    ["512x2048", "1:3"],
    ["512x512", "655360"],
    ["3840x3840", "8294400"],
  ])("rejects invalid custom size %s", (customSize, expectedMessage) => {
    expect(() => mapEasyRouterGptImage2Size({
      aspectRatio: "custom",
      customSize,
    })).toThrow(expectedMessage);
  });

  it("builds the minimal PNG text-to-image request", () => {
    expect(buildEasyRouterImageRequest({
      prompt: " A product photograph ",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "high",
    })).toEqual({
      endpoint: "/images/generations",
      body: {
        model: "gpt-image-2",
        prompt: "A product photograph",
        quality: "high",
        size: "2048x1152",
        output_format: "png",
      },
    });
  });

  it("builds an image-edit multipart body with multiple PNG files", () => {
    const request = buildEasyRouterImageEditRequest({
      prompt: "replace the background",
      aspectRatio: "custom",
      customSize: "1024x1536",
      quality: "medium",
      images: Array.from(
        { length: 16 },
        (_, index) => new Blob([`png-${index + 1}`], { type: "image/png" }),
      ),
    });

    expect(request.endpoint).toBe("/images/edits");
    expect(Object.fromEntries(request.body.entries())).toMatchObject({
      model: "gpt-image-2",
      prompt: "replace the background",
      quality: "medium",
      size: "1024x1536",
      output_format: "png",
    });
    expect(request.body.get("image")).toBeNull();
    expect(request.body.getAll("image[]")).toHaveLength(16);
    expect(request.body.getAll("image[]").every((image) => image instanceof File)).toBe(true);
  });

  it("keeps the documented singular image field for one PNG file", () => {
    const request = buildEasyRouterImageEditRequest({
      prompt: "replace the background",
      aspectRatio: "1:1",
      resolution: "1K",
      quality: "medium",
      images: [new Blob(["png-bytes"], { type: "image/png" })],
    });

    expect(request.body.get("image")).toBeInstanceOf(File);
    expect(request.body.getAll("image[]")).toHaveLength(0);
  });

  it("normalizes URL and base64 image responses", () => {
    expect(EASYROUTER_IMAGE_MODEL_ID).toBe("image 2");
    expect(extractEasyRouterImageUrls({
      data: [
        { url: " https://example.com/image.png " },
        { b64_json: "aGVsbG8=" },
        { url: "https://example.com/image.png" },
      ],
    })).toEqual([
      "https://example.com/image.png",
      "data:image/png;base64,aGVsbG8=",
    ]);
  });

  it("releases the create request before EasyRouter finishes generating", () => {
    const service = readFileSync("lib/generation/image-service.ts", "utf8");
    const branchStart = service.indexOf("    if (isEasyRouterImage) {");
    const branchEnd = service.indexOf("    if (isGoogleAiStudioModel) {", branchStart);
    const branch = service.slice(branchStart, branchEnd);

    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
    expect(branch).toContain("void (async () => {");
    expect(branch.indexOf("void (async () => {")).toBeLessThan(branch.indexOf("easyRouterGenerateImage({"));
    expect(branch).toContain('return { generationId: record.id, taskId: String(record.id), status: "running" };');
    expect(branch).not.toContain('status: "success", outputPaths: [localPath]');
  });

  it("keeps all EasyRouter Image 2 references up to the 16-image limit", () => {
    const service = readFileSync("lib/generation/image-service.ts", "utf8");
    const page = readFileSync("app/image/image-tool.tsx", "utf8");

    expect(service).toContain("isEasyRouterImage && imagePaths.length > 16");
    expect(service).toContain("if (uploadedUrls.length > 16)");
    expect(page).toContain("isEasyRouterImage2Selected ? 16 : undefined}");
  });
});
