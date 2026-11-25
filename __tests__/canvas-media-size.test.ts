import { describe, expect, it } from "vitest";

import { compactCanvasMediaNodeSizes, getCanvasMediaNodeSize, getCanvasRatioMediaNodeSize } from "@/lib/canvas/media-size";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";

describe("canvas media node sizing", () => {
  it("preserves the source aspect ratio with a 350px short edge", () => {
    expect(getCanvasMediaNodeSize(1600, 900)).toEqual({ width: 622, height: 350 });
    expect(getCanvasMediaNodeSize(900, 1600)).toEqual({ width: 350, height: 622 });
    expect(getCanvasMediaNodeSize(1600, 1200)).toEqual({ width: 467, height: 350 });
    expect(getCanvasMediaNodeSize(1200, 1600)).toEqual({ width: 350, height: 467 });
    expect(getCanvasMediaNodeSize(1000, 1000)).toEqual({ width: 350, height: 350 });
  });

  it("falls back to a 350px square when dimensions are missing", () => {
    expect(getCanvasMediaNodeSize(0, 900)).toEqual({ width: 350, height: 350 });
    expect(getCanvasMediaNodeSize(Number.NaN, 900)).toEqual({ width: 350, height: 350 });
  });

  it("normalizes small uploads to the same visual size as generated media with the same ratio", () => {
    expect(getCanvasMediaNodeSize(160, 90)).toEqual({ width: 622, height: 350 });
    expect(getCanvasMediaNodeSize(90, 160)).toEqual({ width: 350, height: 622 });
  });

  it("fits narrow crops and wide strips within 1050px without stretching", () => {
    expect(getCanvasMediaNodeSize(200, 900)).toEqual({ width: 233, height: 1050 });
    expect(getCanvasMediaNodeSize(900, 200)).toEqual({ width: 1050, height: 233 });
    expect(getCanvasMediaNodeSize(100_000, 100)).toEqual({ width: 1050, height: 1 });
    expect(getCanvasMediaNodeSize(100, 100_000)).toEqual({ width: 1, height: 1050 });
    expect(getCanvasMediaNodeSize(350, 1050)).toEqual({ width: 350, height: 1050 });
    expect(getCanvasMediaNodeSize(2100, 900)).toEqual({ width: 817, height: 350 });
  });

  it("caps ratio-derived task frames at 1050px", () => {
    expect(getCanvasRatioMediaNodeSize(16, 9)).toEqual({ width: 622, height: 350 });
    expect(getCanvasRatioMediaNodeSize(100, 1)).toEqual({ width: 1050, height: 350 });
    expect(getCanvasRatioMediaNodeSize(1, 100)).toEqual({ width: 350, height: 1050 });
    expect(getCanvasRatioMediaNodeSize(0, 1)).toEqual({ width: 350, height: 350 });
  });
});

describe("saved natural media size repair", () => {
  const narrow = (): CanvasNode => ({ id: "crop", type: "image", position: { x: 40, y: 80 }, width: 350, height: 1575,
    data: { kind: "image", name: "hair.png", url: "/hair.png", variants: { original: { url: "/hair.png", width: 200, height: 900 } } } });
  it("repairs old default bounds and preserves the image, position and original pixels", () => {
    const node = narrow();
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [node] };
    const compacted = compactCanvasMediaNodeSizes(document);
    expect(compacted.nodes[0]).toEqual({ ...node, width: 233, height: 1050 });
    expect(compacted.nodes[0].data).toBe(node.data);
    expect(document.nodes[0].height).toBe(1575);
    expect(compactCanvasMediaNodeSizes(compacted)).toBe(compacted);
  });
  it("keeps custom sizes, ordinary images and nodes without original dimensions intact", () => {
    const custom = { ...narrow(), width: 400, height: 1800 };
    const ordinary: CanvasNode = { ...narrow(), width: 622, height: 350, data: { kind: "image", url: "/wide.png", variants: { original: { url: "/wide.png", width: 1600, height: 900 } } } };
    const unknown: CanvasNode = { ...narrow(), data: { kind: "image", url: "/unknown.png" } };
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [custom, ordinary, unknown] };
    expect(compactCanvasMediaNodeSizes(document)).toBe(document);
  });
});
