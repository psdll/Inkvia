import { describe, expect, it } from "vitest";
import {
  createCanvasHistory,
  pushCanvasHistory,
  replaceCanvasHistoryPresent,
  undoCanvasHistory,
  redoCanvasHistory,
} from "@/lib/canvas/history";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";

describe("canvas v2 command history", () => {
  it("undoes and redoes committed document snapshots", () => {
    const empty = createEmptyCanvasDocumentV2();
    const oneNode = {
      ...empty,
      nodes: [{ id: "p1", type: "prompt" as const, position: { x: 0, y: 0 }, data: { kind: "prompt" as const, text: "hello" } }],
    };
    const twoNodes = {
      ...oneNode,
      nodes: [...oneNode.nodes, { id: "p2", type: "prompt" as const, position: { x: 200, y: 0 }, data: { kind: "prompt" as const, text: "world" } }],
    };

    let history = createCanvasHistory(empty);
    expect(history.future).toEqual([]);
    history = pushCanvasHistory(history, oneNode);
    history = pushCanvasHistory(history, twoNodes);
    history = undoCanvasHistory(history);
    expect(history.present.nodes.map((node) => node.id)).toEqual(["p1"]);
    history = undoCanvasHistory(history);
    expect(history.present.nodes).toEqual([]);
    history = redoCanvasHistory(history);
    expect(history.present).toBe(oneNode);
    history = redoCanvasHistory(history);
    expect(history.present).toBe(twoNodes);
    expect(history.future).toEqual([]);
    expect(redoCanvasHistory(history)).toBe(history);
  });

  it("clears redo when an edit creates a new history branch", () => {
    const empty = createEmptyCanvasDocumentV2();
    const changed = { ...empty, viewport: { x: 10, y: 0, zoom: 1 } };
    const history = undoCanvasHistory(pushCanvasHistory(createCanvasHistory(empty), changed));
    expect(history.future).toHaveLength(1);
    expect(pushCanvasHistory(history, { ...empty }).future).toEqual([]);
    expect(replaceCanvasHistoryPresent(history, { ...empty }).future).toEqual([]);
  });

  it("caps retained snapshots", () => {
    const empty = createEmptyCanvasDocumentV2();
    let history = createCanvasHistory(empty, 2);
    for (let index = 0; index < 4; index += 1) {
      history = pushCanvasHistory(history, { ...empty, viewport: { x: index, y: 0, zoom: 1 } });
    }
    expect(history.past).toHaveLength(2);
    history = undoCanvasHistory(history);
    expect(history.present.viewport.x).toBe(2);
  });

  it("replaces a coalesced present without consuming another step", () => {
    const empty = createEmptyCanvasDocumentV2();
    const oneNode = {
      ...empty,
      nodes: [{ id: "p1", type: "prompt" as const, position: { x: 0, y: 0 }, data: { kind: "prompt" as const, text: "hello" } }],
    };
    const editedNode = {
      ...oneNode,
      nodes: [{ ...oneNode.nodes[0], data: { kind: "prompt" as const, text: "hello world" } }],
    };
    let history = pushCanvasHistory(createCanvasHistory(empty), oneNode);
    history = replaceCanvasHistoryPresent(history, editedNode);
    expect(history.past).toHaveLength(1);
    expect(history.present).toBe(editedNode);
  });
});
