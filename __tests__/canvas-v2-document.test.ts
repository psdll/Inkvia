import { describe, expect, it } from "vitest";

describe("CanvasDocumentV2", () => {
  it("creates an empty versioned smart canvas document", async () => {
    const module = await import("@/lib/canvas/document").catch(() => ({}));
    const createEmptyCanvasDocumentV2 = (module as any).createEmptyCanvasDocumentV2;

    expect(createEmptyCanvasDocumentV2).toBeTypeOf("function");
    expect(createEmptyCanvasDocumentV2()).toEqual({
      schemaVersion: 2,
      mode: "smart",
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    });
  });

  it("accepts V2 documents and rejects legacy or malformed documents", async () => {
    const module = await import("@/lib/canvas/document");
    const parseCanvasDocumentV2 = (module as any).parseCanvasDocumentV2;
    const valid = {
      ...(module as any).createEmptyCanvasDocumentV2(),
      nodes: [
        {
          id: "image-1",
          type: "image",
          position: { x: 20, y: 30 },
          data: { kind: "image", url: "/uploads/example.png", name: "example" },
        },
      ],
    };

    expect(parseCanvasDocumentV2).toBeTypeOf("function");
    expect(parseCanvasDocumentV2(valid)).toEqual(valid);
    expect(() => parseCanvasDocumentV2({ ...valid, schemaVersion: 1 })).toThrow();
    expect(() => parseCanvasDocumentV2({ ...valid, nodes: [{ id: "broken" }] })).toThrow();
  });

  it("accepts legacy and hydrated audio nodes while rejecting malformed waveform metadata", async () => {
    const module = await import("@/lib/canvas/document");
    const parseCanvasDocumentV2 = (module as any).parseCanvasDocumentV2;
    const empty = (module as any).createEmptyCanvasDocumentV2();
    const audioNode = {
      id: "audio-1",
      type: "audio",
      position: { x: 20, y: 30 },
      data: { kind: "audio", url: "/uploads/example.mp3", name: "example.mp3" },
      width: 380,
      height: 112,
    };

    const legacy = { ...empty, nodes: [audioNode] };
    const hydrated = {
      ...empty,
      nodes: [{
        ...audioNode,
        data: {
          ...audioNode.data,
          waveformPeaks: Array.from({ length: 80 }, (_, index) => index % 101),
          durationSeconds: 42.5,
        },
      }],
    };
    const malformed = {
      ...empty,
      nodes: [{
        ...audioNode,
        data: { ...audioNode.data, waveformPeaks: [101], durationSeconds: -1 },
      }],
    };

    expect(parseCanvasDocumentV2(legacy)).toEqual(legacy);
    expect(parseCanvasDocumentV2(hydrated)).toEqual(hydrated);
    expect(() => parseCanvasDocumentV2(malformed)).toThrow();
  });

  it("accepts legacy video task fields that the canvas no longer uses", async () => {
    const module = await import("@/lib/canvas/document");
    const empty = (module as any).createEmptyCanvasDocumentV2();
    const legacy = {
      ...empty,
      nodes: [{
        id: "video-task-1",
        type: "videoTask",
        position: { x: 20, y: 30 },
        data: {
          kind: "videoTask",
          model: "seedance-1.5-pro",
          prompt: "",
          mediaPaths: [],
          cameraFixed: true,
          watermark: true,
          status: "idle",
        },
      }],
    };

    expect((module as any).parseCanvasDocumentV2(legacy)).toEqual(legacy);
  });
});
