import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { restoreCreativeAgentMediaSizes } from "@/lib/creative-agent/media-layout";

const image = (id: string, width: number, height: number): CanvasNode => ({
  id, type: "image", position: { x: 0, y: 0 }, width: 360, height: 360,
  data: { kind: "image", origin: "generated", name: `Agent 图片 · ${id}`, mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff", url: `/uploads/${id}.png`,
    variants: { original: { url: `/uploads/${id}.png`, width, height } } },
});

describe("Agent media uses native canvas sizing", () => {
  it("restores portrait and landscape proportions without changing other artwork", () => {
    const manual = { ...image("3", 1024, 1024), data: { ...image("3", 1024, 1024).data, name: "手动素材" }, position: { x: -900, y: 0 } } as CanvasNode;
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [image("1", 1728, 2304), { ...image("2", 2560, 1440), position: { x: 460, y: 0 } }, manual] };
    const next = restoreCreativeAgentMediaSizes(document);
    expect(next.nodes[0]).toMatchObject({ width: 350, height: 467 });
    expect(next.nodes[1]).toMatchObject({ width: 622, height: 350 });
    expect(next.nodes[2]).toBe(manual);
    expect(next.nodes[1].position.x).toBeGreaterThanOrEqual(next.nodes[0].position.x + 350);
    expect(next.viewport).toBe(document.viewport);
    expect(restoreCreativeAgentMediaSizes(next)).toBe(next);
  });

  it("preserves manual resizing and waits for real dimensions", () => {
    const resized = { ...image("1", 1728, 2304), width: 500, height: 667 };
    const pending = image("2", 2560, 1440);
    if (pending.data.kind === "image") pending.data.variants = undefined;
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [resized, pending] };
    expect(restoreCreativeAgentMediaSizes(document)).toBe(document);
  });
});
