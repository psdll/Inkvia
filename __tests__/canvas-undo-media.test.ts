import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { createCanvasHistory, pushCanvasHistory, undoCanvasHistory } from "@/lib/canvas/history";
import {
  collectCanvasDocumentUndoMediaRefs,
  collectCanvasHistoryUndoMediaRefs,
} from "@/lib/canvas/undo-media";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_REF = "/uploads/canvas_imports/1/example.png";

function createDocumentWithImage() {
  const empty = createEmptyCanvasDocumentV2();
  return {
    ...empty,
    nodes: [
      {
        id: "image-1",
        type: "image" as const,
        position: { x: 0, y: 0 },
        data: {
          kind: "image" as const,
          name: "example.png",
          url: PUBLIC_REF,
          mediaId: MEDIA_ID,
        },
      },
    ],
  };
}

describe("canvas undo media refs", () => {
  it("protects media only present in redo snapshots", () => {
    const history = undoCanvasHistory(pushCanvasHistory(
      createCanvasHistory(createEmptyCanvasDocumentV2()), createDocumentWithImage(),
    ));
    expect(history.present.nodes).toEqual([]);
    expect(collectCanvasHistoryUndoMediaRefs(history)).toHaveLength(2);
  });
  it("collects normalized media IDs and local import refs from a document", () => {
    expect(collectCanvasDocumentUndoMediaRefs(createDocumentWithImage())).toEqual([
      { key: `media:${MEDIA_ID}`, mediaId: MEDIA_ID },
      { key: `url:${PUBLIC_REF}`, publicRef: PUBLIC_REF },
    ]);
  });

  it("holds media referenced by past snapshots but absent from present", () => {
    const withImage = createDocumentWithImage();
    const deleted = pushCanvasHistory(
      createCanvasHistory(withImage),
      createEmptyCanvasDocumentV2(),
    );

    expect(collectCanvasHistoryUndoMediaRefs(deleted)).toEqual([
      { key: `media:${MEDIA_ID}`, mediaId: MEDIA_ID },
      { key: `url:${PUBLIC_REF}`, publicRef: PUBLIC_REF },
    ]);
  });

  it("does not hold media restored into the present document", () => {
    const withImage = createDocumentWithImage();
    const restored = undoCanvasHistory(
      pushCanvasHistory(createCanvasHistory(withImage), createEmptyCanvasDocumentV2()),
    );

    expect(collectCanvasHistoryUndoMediaRefs(restored)).toEqual([]);
  });

  it("deduplicates media across retained snapshots", () => {
    const withImage = createDocumentWithImage();
    let history = createCanvasHistory(withImage);
    history = pushCanvasHistory(history, {
      ...withImage,
      viewport: { x: 10, y: 0, zoom: 1 },
    });
    history = pushCanvasHistory(history, createEmptyCanvasDocumentV2());

    expect(collectCanvasHistoryUndoMediaRefs(history)).toHaveLength(2);
  });
});
