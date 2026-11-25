import { describe, expect, it } from "vitest";
import * as batchTypes from "../components/batch-workbench/types";
import type {
  BatchItem,
  BatchOutput,
} from "../components/batch-workbench/types";

type BatchGroupResultPreview = {
  entries: Array<{ itemId: string; outputId: string; src: string }>;
  initialIndex: number;
};

type PreviewBuilder = (
  items: BatchItem[],
  selectedOutputId: string,
) => BatchGroupResultPreview | null;

const buildBatchGroupResultPreview = (
  batchTypes as typeof batchTypes & {
    buildBatchGroupResultPreview?: PreviewBuilder;
  }
).buildBatchGroupResultPreview;

function createOutput(
  id: string,
  localPath: string | null,
  attempt = 1,
): BatchOutput {
  return {
    id,
    slotIndex: 0,
    attempt,
    status: localPath ? "succeeded" : "failed",
    generation: localPath
      ? {
          id: attempt,
          status: "succeeded",
          localPath,
          errorMsg: null,
          finishedAt: null,
          updatedAt: "2026-07-31T00:00:00.000Z",
        }
      : null,
  };
}

function createItem(
  id: string,
  position: number,
  outputs: BatchOutput[],
): BatchItem {
  return {
    id,
    position,
    name: id,
    prompt: "",
    includeSharedPrompt: true,
    overrides: {},
    outputCount: 1,
    status: "completed",
    media: [],
    outputs,
  };
}

describe("batch group result preview", () => {
  it("opens at the clicked task result and keeps the other successful group images in card order", () => {
    if (!buildBatchGroupResultPreview) {
      expect(buildBatchGroupResultPreview).toBeTypeOf("function");
      return;
    }

    const preview = buildBatchGroupResultPreview(
      [
        createItem("item-1", 0, [createOutput("output-1", "/one.png")]),
        createItem("item-2", 1, [
          createOutput("output-2-old", "/two-old.png"),
          createOutput("output-2", "/two.png", 2),
        ]),
        createItem("item-3", 2, [createOutput("output-3", null)]),
        createItem("item-4", 3, [createOutput("output-4", "/four.png")]),
      ],
      "output-2",
    );

    expect(preview).toEqual({
      entries: [
        { itemId: "item-1", outputId: "output-1", src: "/one.png" },
        { itemId: "item-2", outputId: "output-2", src: "/two.png" },
        { itemId: "item-4", outputId: "output-4", src: "/four.png" },
      ],
      initialIndex: 1,
    });
  });

  it("does not open when the clicked result is not previewable", () => {
    if (!buildBatchGroupResultPreview) {
      expect(buildBatchGroupResultPreview).toBeTypeOf("function");
      return;
    }

    expect(
      buildBatchGroupResultPreview(
        [createItem("item-1", 0, [createOutput("output-1", null)])],
        "output-1",
      ),
    ).toBeNull();
  });
});
