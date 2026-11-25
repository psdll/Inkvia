import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class QueueError extends Error {}
  return {
    QueueError,
    ensureThumbnail: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
  };
});

vi.mock("fs-extra", () => ({
  default: {
    stat: mocks.stat,
    readFile: mocks.readFile,
  },
}));

vi.mock("@/lib/public-path", () => ({
  resolvePublicPath: () => "C:/uploads",
}));

vi.mock("@/lib/thumbnail-cache", () => ({
  THUMBNAIL_CACHE_WIDTHS: [120, 300, 600, 1200],
  ThumbnailQueueFullError: mocks.QueueError,
  thumbnailCache: { ensureThumbnail: mocks.ensureThumbnail },
}));

vi.mock("sharp", () => ({ default: () => {
  const image = { rotate: () => image, resize: () => image, webp: () => image, toBuffer: async () => Buffer.from("small thumbnail") };
  return image;
} }));

import { GET } from "@/app/api/thumb/route";

describe("thumbnail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 6, mtimeMs: 123 });
    mocks.readFile.mockResolvedValue(Buffer.from("source"));
  });

  it("does not expose personal library originals through the public thumbnail endpoint", async () => {
    for (const src of ["/uploads/canvas-library/27/产品/test.png", "/uploads/./CANVAS-LIBRARY/27/_catalog.json", "/uploads/canvas-library. /27/test.png"]) {
      const response = await GET(new NextRequest(`http://localhost/api/thumb?src=${encodeURIComponent(src)}&w=120`));
      expect(response.status).toBe(400);
    }
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.ensureThumbnail).not.toHaveBeenCalled();
  });

  it("falls back to the original image when Sharp conversion fails", async () => {
    mocks.ensureThumbnail.mockRejectedValue(new Error("sharp failed"));

    const response = await GET(new NextRequest("http://localhost/api/thumb?src=/uploads/source.png&w=600"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("source");
  });

  it("serves a cached video poster without downloading the movie", async () => {
    mocks.ensureThumbnail.mockResolvedValue({ buffer: Buffer.from("poster"), status: "hit" });
    const response = await GET(new NextRequest("http://localhost/api/thumb?src=/uploads/clip.mp4&w=200&poster=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("never falls back to sending a whole video when poster preparation fails", async () => {
    mocks.ensureThumbnail.mockRejectedValue(new Error("ffmpeg unavailable"));
    const response = await GET(new NextRequest("http://localhost/api/thumb?src=/uploads/clip.mp4&w=200&poster=1"));
    expect(response.status).toBe(503);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("returns 503 with a short retry header when the Sharp queue is full", async () => {
    mocks.ensureThumbnail.mockRejectedValue(new mocks.QueueError("full"));

    const response = await GET(new NextRequest("http://localhost/api/thumb?src=/uploads/source.png&w=600"));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("does not count disk-cache hits against the expensive image generation budget", async () => {
    mocks.ensureThumbnail.mockResolvedValue({ buffer: Buffer.from("cached"), status: "hit" });
    for (let index = 0; index < 650; index++) {
      const response = await GET(new NextRequest(`http://localhost/api/thumb?src=/uploads/cached-${index}.png&w=300`, { headers: { 'x-forwarded-for': 'cached-reader' } }));
      expect(response.status).toBe(200);
    }
  });

  it("still rate limits new conversions and never returns an original to bypass that limit", async () => {
    mocks.ensureThumbnail.mockImplementation(async input => ({ buffer: await input.convert(), status: 'generated' }));
    for (let index = 0; index < 600; index++) {
      const response = await GET(new NextRequest(`http://localhost/api/thumb?src=/uploads/cold-${index}.png&w=300`, { headers: { 'x-forwarded-for': 'cold-reader' } }));
      expect(response.status).toBe(200);
    }
    const response = await GET(new NextRequest('http://localhost/api/thumb?src=/uploads/extra.png&w=300', { headers: { 'x-forwarded-for': 'cold-reader' } }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
