import { describe, expect, it } from "vitest";
import { buildCanvasHistoryRows, canvasHistoryReferences, type CanvasHistoryAsset } from "@/lib/assets/canvas-history";
describe("canvas generation history layout and references", () => {
  it("keeps date headings and stable row keys across page boundaries", () => {
    const items = [1, 2, 3, 4, 5].map(id => ({ id, createdAt: id < 4 ? "2026-09-10T12:00:00" : "2026-09-09T12:00:00" }) as CanvasHistoryAsset);
    expect(buildCanvasHistoryRows(items, 2)).toEqual([
      { key: "1", date: "2026-09-10", items: items.slice(0, 2) },
      { key: "3", items: items.slice(2, 3) },
      { key: "4", date: "2026-09-09", items: items.slice(3, 5) },
    ]);
  });
  it("lays out 50,000 records in fixed-size virtual rows with no lost assets", () => {
    const items = Array.from({ length: 50000 }, (_, id) => ({ id, createdAt: "2026-09-10T12:00:00" }) as CanvasHistoryAsset);
    const rows = buildCanvasHistoryRows(items, 10);
    expect(rows).toHaveLength(5000);
    expect(rows.reduce((sum, row) => sum + row.items.length, 0)).toBe(50000);
    expect(rows.at(-1)?.items.at(-1)?.id).toBe(49999);
  });
  it("deduplicates image/video/audio references while rejecting unusable values", () => {
    const refs = canvasHistoryReferences({ inputMedia: [{ url: "/uploads/a.mp3", kind: "audio" }], references: [{ url: "/uploads/b.png", kind: "image" }], imagePaths: ["/uploads/b.png", "javascript:alert(1)"], mediaPaths: ["/uploads/c.mp4"] });
    expect(refs.map(ref => ref.kind)).toEqual(["audio", "image", "video"]);
    expect(canvasHistoryReferences({ references: "invalid", inputMedia: null })).toEqual([]);
  });
});
