import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invalidateCanvasVideoPoster, readCanvasVideoPoster, writeCanvasVideoPoster } from "@/lib/canvas/video-poster-cache";

let entries: Map<string, string>;
let storage: { open: ReturnType<typeof vi.fn> };
const frame = { url: "data:image/jpeg;base64,frame", tier: 100 };
beforeEach(() => {
  entries = new Map();
  storage = { open: vi.fn(async () => ({
    match: async (key: string) => entries.has(key) ? new Response(entries.get(key)) : undefined,
    put: async (key: string, response: Response) => { entries.set(key, await response.text()); },
    delete: async (key: string) => entries.delete(key),
    keys: async () => [...entries.keys()],
  })) };
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("location", { origin: "http://localhost" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("restores extracted posters after memory loss without crossing account or source boundaries", async () => {
  await writeCanvasVideoPoster(7, "/uploads/a.mp4", frame);
  expect(await readCanvasVideoPoster(7, "/uploads/a.mp4")).toEqual(frame);
  expect(await readCanvasVideoPoster(8, "/uploads/a.mp4")).toBeNull();
  expect(await readCanvasVideoPoster(7, "/uploads/b.mp4")).toBeNull();
});

it("keeps the best resolution and bounds simultaneous writes to 256 entries", async () => {
  await writeCanvasVideoPoster(7, "/a.mp4", { ...frame, tier: 800 });
  await writeCanvasVideoPoster(7, "/a.mp4", frame);
  expect((await readCanvasVideoPoster(7, "/a.mp4"))?.tier).toBe(800);
  await invalidateCanvasVideoPoster(7, "/a.mp4");
  await writeCanvasVideoPoster(7, "/a.mp4", frame);
  expect((await readCanvasVideoPoster(7, "/a.mp4"))?.tier).toBe(100);
  await Promise.all(Array.from({ length: 260 }, (_, i) => writeCanvasVideoPoster(7, `/v${i}.mp4`, frame)));
  expect(entries.size).toBe(256);
  expect(await readCanvasVideoPoster(7, "/v259.mp4")).toEqual(frame);
  expect(await readCanvasVideoPoster(7, "/a.mp4")).toBeNull();
});

it("treats expired, corrupt, denied and unavailable storage as cache misses", async () => {
  await writeCanvasVideoPoster(7, "/a.mp4", frame);
  const key = [...entries.keys()][0];
  entries.set(key, JSON.stringify({ ...frame, savedAt: Date.now() - 8 * 86400000 }));
  expect(await readCanvasVideoPoster(7, "/a.mp4")).toBeNull();
  entries.set(key, "not json");
  expect(await readCanvasVideoPoster(7, "/a.mp4")).toBeNull();
  storage.open.mockRejectedValue(new Error("denied"));
  expect(await readCanvasVideoPoster(7, "/a.mp4")).toBeNull();
  vi.stubGlobal("caches", undefined);
  expect(await readCanvasVideoPoster(7, "/a.mp4")).toBeNull();
});

it("ignores temporary uploads and guests", async () => {
  expect(await readCanvasVideoPoster(7, "blob:upload")).toBeNull();
  expect(await readCanvasVideoPoster("guest", "/a.mp4")).toBeNull();
  expect(storage.open).not.toHaveBeenCalled();
});
