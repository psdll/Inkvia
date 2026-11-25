import { describe, expect, it } from "vitest";
import {
  buildMediaOriginalCandidates,
  buildMediaPreviewCandidates,
  buildMediaPreviewUrl,
  buildMediaOriginalUrl,
} from "@/lib/media-url";

describe("local media URL resilience", () => {
  it.each(["data:image/webp;base64,AAAA", "blob:http://localhost:3100/example"])("leaves browser-owned image URLs intact: %s", (source) => {
    expect(buildMediaPreviewUrl(source)).toBe(source);
    expect(buildMediaPreviewCandidates(source)).toEqual([source]);
    expect(buildMediaOriginalUrl(source)).toBe(source);
    expect(buildMediaOriginalCandidates(source)).toEqual([source]);
  });
  it("routes generated display assets through the thumbnail endpoint first", () => {
    const source = "/uploads/generation_previews/2026/08/result.webp";

    expect(buildMediaPreviewCandidates(source, { width: 600 })).toEqual([
      `/api/thumb?src=${encodeURIComponent(source)}&w=600`,
      source,
    ]);
  });

  it("keeps a local original fallback for full-size viewers", () => {
    const source = "/uploads/generations/2026/08/result.png";

    expect(buildMediaOriginalCandidates(source)).toEqual([
      `/api/thumb?src=${encodeURIComponent(source)}&w=1200`,
      source,
    ]);
  });
});
