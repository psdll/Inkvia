import { describe, expect, it } from "vitest";
import {
  TUZI_GPT_IMAGE_2_MODEL_ID,
  TUZI_GPT_IMAGE_2_UPSTREAM_MODEL,
  mapTuziGptImage2Size,
  normalizeTuziGptImage2Params,
} from "@/lib/tuzi-image-params";
import {
  buildTuziImageEditRequest,
  buildTuziImageRequest,
  extractTuziImageUrls,
  readTuziImageResponse,
} from "@/lib/tuzi-image";

describe("TuZi GPT-Image-2 parameter mapping", () => {
  it("maps only TuZi ratios and resolutions to documented pixel sizes", () => {
    expect(TUZI_GPT_IMAGE_2_MODEL_ID).toBe("gpt-image-2-tuzi");
    expect(TUZI_GPT_IMAGE_2_UPSTREAM_MODEL).toBe("gpt-image-2");
    expect(mapTuziGptImage2Size("1:1", "1K")).toBe("1024x1024");
    expect(mapTuziGptImage2Size("3:2", "2K")).toBe("2048x1360");
    expect(mapTuziGptImage2Size("16:9", "4K")).toBe("3840x2160");
    expect(mapTuziGptImage2Size("auto", "2K")).toBe("auto");
    expect(() => mapTuziGptImage2Size("1:1", "4K")).toThrow("4K");
  });

  it("normalizes unsupported values without changing another model helper", () => {
    expect(normalizeTuziGptImage2Params({
      quality: "auto",
      resolution: "8K",
      aspectRatio: "custom",
    })).toEqual({ quality: "medium", resolution: "2K", aspectRatio: "1:1" });
    expect(normalizeTuziGptImage2Params({
      quality: "high",
      resolution: "4K",
      aspectRatio: "1:1",
    })).toEqual({ quality: "high", resolution: "4K", aspectRatio: "16:9" });
  });
});

describe("TuZi GPT-Image-2 request adapter", () => {
  it("builds an official-group JSON text-to-image request with one upstream output", () => {
    expect(buildTuziImageRequest({
      prompt: " product photograph ",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "high",
    })).toEqual({
      endpoint: "/images/generations",
      body: {
        model: "gpt-image-2",
        prompt: "product photograph",
        n: 1,
        size: "2048x1152",
        quality: "high",
        output_format: "png",
      },
    });
  });

  it("always sends one or many references as ordered image[] multipart fields", () => {
    const images = Array.from(
      { length: 16 },
      (_, index) => new Blob([`png-${index + 1}`], { type: "image/png" }),
    );
    const request = buildTuziImageEditRequest({
      prompt: "combine every reference",
      aspectRatio: "1:1",
      resolution: "2K",
      quality: "medium",
      images,
    });

    expect(request.endpoint).toBe("/images/edits");
    expect(request.body.get("image")).toBeNull();
    expect(request.body.getAll("image[]")).toHaveLength(16);
    expect((request.body.getAll("image[]")[0] as File).name).toBe("image-1.png");
    expect((request.body.getAll("image[]")[15] as File).name).toBe("image-16.png");
    expect(Object.fromEntries(request.body.entries())).toMatchObject({
      model: "gpt-image-2",
      prompt: "combine every reference",
      n: "1",
      size: "2048x2048",
      quality: "medium",
      output_format: "png",
    });
    expect(request.body.get("response_format")).toBeNull();

    const single = buildTuziImageEditRequest({
      prompt: "edit",
      images: [images[0]],
    });
    expect(single.body.get("image")).toBeNull();
    expect(single.body.getAll("image[]")).toHaveLength(1);
  });

  it("accepts a PNG reference larger than the legacy 4MB limit", () => {
    const image = new Blob(
      [new Uint8Array(4 * 1024 * 1024 + 1)],
      { type: "image/png" },
    );

    const request = buildTuziImageEditRequest({
      prompt: "preserve the reference",
      images: [image],
    });

    expect(request.body.getAll("image[]")).toHaveLength(1);
    expect((request.body.getAll("image[]")[0] as File).size).toBe(4 * 1024 * 1024 + 1);
  });

  it("rejects excessive references and edit prompts before submission", () => {
    const png = new Blob(["png"], { type: "image/png" });

    expect(() => buildTuziImageEditRequest({
      prompt: "too many",
      images: Array.from({ length: 17 }, () => png),
    })).toThrow("16");
    expect(() => buildTuziImageEditRequest({
      prompt: "x".repeat(1001),
      images: [png],
    })).toThrow("1000");
  });

  it("attaches an optional PNG mask and normalizes URL/base64 responses", () => {
    const png = new Blob(["png"], { type: "image/png" });
    const request = buildTuziImageEditRequest({
      prompt: "masked edit",
      images: [png],
      mask: png,
    });

    expect(request.body.get("mask")).toBeInstanceOf(File);
    expect(extractTuziImageUrls({
      data: [
        { url: " https://example.com/result.png " },
        { b64_json: "aGVsbG8=" },
        { url: "https://example.com/result.png" },
      ],
    })).toEqual([
      "https://example.com/result.png",
      "data:image/png;base64,aGVsbG8=",
    ]);
  });

  it("does not disguise an interrupted successful response body as an empty image result", async () => {
    const malformedSuccess = new Response('{"data":[', {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(readTuziImageResponse(malformedSuccess)).rejects.toThrow(
      "响应数据读取中断，提交结果未知",
    );
  });
});
