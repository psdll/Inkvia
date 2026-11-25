// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { materialCardImageCandidates, materialCardVideoPosterCandidates } from "@/lib/material-card-preview";
import { warmMaterialsEntry } from "@/lib/client/materials-entry";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: mocks.request }));
afterEach(() => vi.unstubAllGlobals());

it("preloads the same 1200px image used by the card instead of the old 600px thumbnail", async () => {
  const item = { imageUrl: "/uploads/full.png", thumbnailUrl: "/uploads/old.webp", mediaItems: [{ width: 600 }] };
  const sources: string[] = [];
  vi.stubGlobal("Image", class { set src(value: string) { sources.push(value); } });
  mocks.request.mockResolvedValue({ ok: true, json: { items: [item] } });
  warmMaterialsEntry("preview-match");
  await Promise.resolve();
  expect(sources).toEqual([materialCardImageCandidates(item)[0]]);
  expect(sources[0]).toBe("/api/thumb?src=%2Fuploads%2Ffull.png&w=1200");
});

it("uses the prepared image directly even when the original was smaller than 1200px", () => {
  const item = { imageUrl: "/uploads/small.png", thumbnailUrl: "/uploads/thumbs/small-card-1200.webp", mediaItems: [{ width: 800 }] };
  expect(materialCardImageCandidates(item)[0]).toBe(item.thumbnailUrl);
});

it("warms a video poster at the same size and skips missing posters instead of downloading videos", async () => {
  const poster = { imageUrl: "/uploads/video.mp4", thumbnailUrl: "/uploads/poster.webp" };
  const sources: string[] = [];
  vi.stubGlobal("Image", class { set src(value: string) { sources.push(value); } });
  mocks.request.mockResolvedValue({ ok: true, json: { items: [poster, { imageUrl: "/uploads/no-poster.mp4" }] } });
  warmMaterialsEntry("poster-match");
  await Promise.resolve();
  expect(sources).toEqual([materialCardVideoPosterCandidates(poster)[0]]);
  expect(sources[0]).toBe("/api/thumb?src=%2Fuploads%2Fposter.webp&w=1200");
});
