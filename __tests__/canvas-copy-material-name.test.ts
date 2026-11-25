import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { duplicateSelection } from "@/lib/canvas/graph";
import { getCanvasMediaDownloadName, getCanvasMediaNodeName } from "@/lib/canvas/material-name";

describe("copied canvas material names", () => {
  it.each([
    ["image", "10086", "10086 - 副本", "/image.png"],
    ["image", "10086.png", "10086 - 副本.png", "/image.png"],
    ["video", "片段.mp4", "片段 - 副本.mp4", "/video.mp4"],
    ["audio", "录音.wav", "录音 - 副本.wav", "/audio.wav"],
  ] as const)("labels a copied %s named %s without changing its shared media", (kind, name, copiedName, url) => {
    const mediaId = "d31782e3-d0fb-4aa1-9096-a7d16878cd55";
    const original: CanvasNode = { id: "original", type: kind, position: { x: 0, y: 0 }, data: { kind, name, url, mediaId } };
    const source = { ...createEmptyCanvasDocumentV2(), nodes: [original] };
    const copied = duplicateSelection(source, [original.id]);

    expect(getCanvasMediaNodeName(copied.document, copied.selectedIds[0])).toBe(copiedName);
    expect(copied.document.nodes[1].data).toMatchObject({ name: copiedName, url, mediaId });
    expect(original.data).toMatchObject({ name });
    expect(copied.document.nodes[0]).toBe(original);
  });

  it("copies an unnamed node using its current visible name instead of a new ordinal", () => {
    const source = { ...createEmptyCanvasDocumentV2(), nodes: [
      { id: "original", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/image.png" } } as CanvasNode,
    ] };
    const originalName = getCanvasMediaNodeName(source, "original");
    const copied = duplicateSelection(source, ["original"]);
    expect(getCanvasMediaNodeName(copied.document, copied.selectedIds[0])).toBe(`${originalName} - 副本`);
  });

  it.each([
    ["10086 - 副本", "/image.png?token=1", "image", "image/png", "10086 - 副本.png"],
    ["10086 - 副本.PNG", "/image.png", "image", "image/png", "10086 - 副本.PNG"],
    ["产品.v2 - 副本", "/image.webp", "image", "image/webp", "产品.v2 - 副本.webp"],
    ["片段 - 副本", "/video.mov", "video", "video/quicktime", "片段 - 副本.mov"],
    ["录音 - 副本", "/api/media/123", "audio", "audio/wav", "录音 - 副本.wav"],
    ["照片 - 副本", "/api/media/123", "image", "image/jpeg", "照片 - 副本.jpg"],
  ] as const)("downloads %s with the correct extension", (name, url, kind, mimeType, expected) => {
    expect(getCanvasMediaDownloadName({ name, url, kind }, mimeType)).toBe(expected);
  });
});
