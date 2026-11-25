import { describe, expect, it } from "vitest";
import { buildApimartImageRequest, extractApimartImageUrls } from "@/lib/apimart-image";

describe("APIMart GPT-Image-2 mapping", () => {
  it("builds a text-to-image request with APIMart parameter names", () => {
    const request = buildApimartImageRequest({
      prompt: "A clean product photo",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "high",
      background: "opaque",
      moderation: "low",
      outputFormat: "png",
      n: 3,
    });

    expect(request).toMatchObject({
      model: "gpt-image-2-official",
      prompt: "A clean product photo",
      size: "16:9",
      resolution: "2k",
      quality: "high",
      background: "opaque",
      moderation: "low",
      output_format: "png",
      n: 3,
    });
    expect(request).not.toHaveProperty("image_urls");
    expect(request).not.toHaveProperty("mask_url");
    expect(request).not.toHaveProperty("output_compression");
  });

  it("normalizes image-to-image, mask, compression, and transparent background", () => {
    const request = buildApimartImageRequest({
      prompt: "Edit this image",
      aspectRatio: "9:21",
      resolution: "4K",
      quality: "medium",
      background: "transparent",
      moderation: "auto",
      outputFormat: "webp",
      outputCompression: 105,
      n: 8,
      imageUrls: [" https://example.com/a.png ", "", "https://example.com/b.png"],
      maskUrl: " https://example.com/mask.png ",
    });

    expect(request).toMatchObject({
      size: "9:21",
      resolution: "4k",
      quality: "medium",
      background: "auto",
      moderation: "auto",
      output_format: "webp",
      output_compression: 100,
      n: 4,
      image_urls: ["https://example.com/a.png", "https://example.com/b.png"],
      mask_url: "https://example.com/mask.png",
    });
  });

  it("does not send mask or compression when APIMart should ignore them", () => {
    const request = buildApimartImageRequest({
      prompt: "A poster",
      outputFormat: "png",
      outputCompression: 80,
      maskUrl: "https://example.com/mask.png",
    });

    expect(request).not.toHaveProperty("output_compression");
    expect(request).not.toHaveProperty("mask_url");
  });

  it("extracts all completed image urls from APIMart task responses", () => {
    const urls = extractApimartImageUrls({
      data: {
        result: {
          images: [
            { url: ["https://example.com/a.png", "https://example.com/b.png"] },
            { url: ["https://example.com/a.png"] },
            { image_url: "https://example.com/c.png" },
          ],
        },
      },
    });

    expect(urls).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
      "https://example.com/c.png",
    ]);
  });

  it("extracts alternate completed APIMart image result shapes", () => {
    expect(
      extractApimartImageUrls({
        data: {
          result: {
            image_urls: ["https://example.com/a.png"],
            outputs: [{ download_url: "https://example.com/b.png" }],
          },
        },
      })
    ).toEqual(["https://example.com/a.png", "https://example.com/b.png"]);
  });
});
