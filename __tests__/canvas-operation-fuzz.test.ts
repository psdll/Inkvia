import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { createCanvasDocumentMutation } from "@/lib/canvas/document-diff";
import { applyCanvasOperations, type CanvasOperation } from "@/lib/canvas/operations";
import { buildCanvasSnapshot, decodeCanvasSnapshot } from "@/lib/canvas/snapshot-codec";

function random(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("canvas operation fuzz consistency", () => {
  it("keeps memory, snapshot reload and full replay identical across 10,000 random edits", () => {
    const nextRandom = random();
    let document = createEmptyCanvasDocumentV2();
    const history: CanvasOperation[][] = [];
    let nextNodeId = 1;

    for (let index = 0; index < 10_000; index += 1) {
      const before = document;
      const selected = document.nodes[Math.floor(nextRandom() * document.nodes.length)];
      let operation: CanvasOperation;
      if (!selected || (document.nodes.length < 200 && nextRandom() < 0.22)) {
        const id = `node-${nextNodeId++}`;
        operation = {
          opId: `op-${index}`, kind: "node.create",
          node: {
            id, type: "prompt",
            position: { x: Math.round(nextRandom() * 20_000 - 10_000), y: Math.round(nextRandom() * 20_000 - 10_000) },
            data: { kind: "prompt", text: `seed-${index}` },
          },
        };
      } else if (nextRandom() < 0.12) {
        operation = { opId: `op-${index}`, kind: "node.delete", nodeId: selected.id };
      } else if (nextRandom() < 0.58) {
        operation = {
          opId: `op-${index}`, kind: "node.move", nodeId: selected.id,
          position: { x: Math.round(nextRandom() * 20_000 - 10_000), y: Math.round(nextRandom() * 20_000 - 10_000) },
        };
      } else {
        operation = { opId: `op-${index}`, kind: "node.patch", nodeId: selected.id, patch: { data: { text: `edit-${index}-${Math.floor(nextRandom() * 1000)}` } } };
      }
      document = applyCanvasOperations(document, [operation]);
      history.push([operation]);

      if (index % 137 === 0) {
        const inverse = createCanvasDocumentMutation(document, before, `undo-${index}`).operations;
        document = applyCanvasOperations(document, inverse);
        history.push(inverse);
        document = applyCanvasOperations(document, [operation]);
        history.push([operation]);
      }
      if (index % 500 === 0) document = decodeCanvasSnapshot(buildCanvasSnapshot(document, String(index + 1)));
    }

    let replayed = createEmptyCanvasDocumentV2();
    for (const operations of history) replayed = applyCanvasOperations(replayed, operations);
    expect(buildCanvasSnapshot(replayed, "10000").checksumSha256)
      .toBe(buildCanvasSnapshot(document, "10000").checksumSha256);
  }, 30_000);
});
