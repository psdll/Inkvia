import { describe, expect, it } from "vitest";

import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { createCanvasHistory } from "@/lib/canvas/history";
import { omitPendingCanvasUploads, settleCanvasPendingUpload } from "@/lib/canvas/pending-uploads";

function createDocument(): CanvasDocumentV2 {
  return {
    schemaVersion: 2,
    mode: "smart",
    nodes: [
      {
        id: "pending-image",
        type: "image",
        position: { x: 20, y: 30 },
        data: { kind: "image", url: "blob:local-image", name: "chair.png" },
      },
      {
        id: "prompt",
        type: "prompt",
        position: { x: 400, y: 30 },
        data: { kind: "prompt", text: "Use the uploaded image" },
      },
    ],
    edges: [{ id: "edge-1", source: "pending-image", target: "prompt", type: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { snapToGrid: false, gridSize: 24 },
  };
}

describe("canvas pending uploads", () => {
  it("omits pending nodes and their connected edges from persistence", () => {
    const document = createDocument();

    const persisted = omitPendingCanvasUploads(document, new Set(["pending-image"]));

    expect(persisted.nodes.map((node) => node.id)).toEqual(["prompt"]);
    expect(persisted.edges).toEqual([]);
    expect(document.nodes).toHaveLength(2);
    expect(document.edges).toHaveLength(1);
  });

  it("replaces local URLs throughout the current document and history after success", () => {
    const document = createDocument();
    const history = createCanvasHistory(document);
    history.past = [createDocument()];
    history.future = [createDocument()];

    const settled = settleCanvasPendingUpload(history, document, "pending-image", {
      status: "success",
      url: "/uploads/canvas_imports/1/2026-07-20/chair.png",
      kind: "image",
      mediaId: "d31782e3-d0fb-4aa1-9096-a7d16878cd55",
      variants: {
        original: {
          mediaId: "d31782e3-d0fb-4aa1-9096-a7d16878cd55",
          url: "/uploads/canvas_imports/1/2026-07-20/chair.png",
        },
      },
    });

    expect(settled.document.nodes[0]?.data).toMatchObject({
      kind: "image",
      url: "/uploads/canvas_imports/1/2026-07-20/chair.png",
      mediaId: "d31782e3-d0fb-4aa1-9096-a7d16878cd55",
    });
    expect(JSON.stringify(settled.history)).not.toContain("blob:");
  });

  it("compacts a square pending audio placeholder to the final audio size", () => {
    const document: CanvasDocumentV2 = {
      ...createDocument(),
      nodes: [{
        id: "pending-audio",
        type: "audio",
        position: { x: 20, y: 30 },
        data: { kind: "audio", url: "blob:local-audio", name: "voice.mp3" },
        width: 300,
        height: 300,
      }],
      edges: [],
    };
    const history = createCanvasHistory(document);

    const settled = settleCanvasPendingUpload(history, document, "pending-audio", {
      status: "success",
      url: "/uploads/canvas_imports/1/2026-07-20/voice.mp3",
      kind: "audio",
      mediaId: "audio-media-id",
    });

    expect(settled.document.nodes[0]).toMatchObject({
      type: "audio",
      width: 420,
      height: 200,
      data: { kind: "audio", url: "/uploads/canvas_imports/1/2026-07-20/voice.mp3" },
    });
  });

  it("removes failed nodes and their edges throughout the current document and history", () => {
    const document = createDocument();
    const history = createCanvasHistory(document);
    history.past = [createDocument()];

    const settled = settleCanvasPendingUpload(history, document, "pending-image", { status: "failed" });

    for (const version of [settled.document, ...settled.history.past, settled.history.present]) {
      expect(version.nodes.some((node) => node.id === "pending-image")).toBe(false);
      expect(version.edges.some((edge) => edge.source === "pending-image" || edge.target === "pending-image")).toBe(false);
    }
  });

  it("does not recreate a node that the user deleted before upload success", () => {
    const localDocument = createDocument();
    const deletedDocument = {
      ...localDocument,
      nodes: localDocument.nodes.filter((node) => node.id !== "pending-image"),
      edges: [],
    };
    const history = createCanvasHistory(localDocument);
    history.past = [localDocument];

    const settled = settleCanvasPendingUpload(history, deletedDocument, "pending-image", {
      status: "success",
      url: "/uploads/canvas_imports/1/2026-07-20/chair.png",
      kind: "image",
      mediaId: "d31782e3-d0fb-4aa1-9096-a7d16878cd55",
    });

    expect(settled.document.nodes.some((node) => node.id === "pending-image")).toBe(false);
    expect(JSON.stringify(settled.history)).not.toContain("blob:");
  });
});
