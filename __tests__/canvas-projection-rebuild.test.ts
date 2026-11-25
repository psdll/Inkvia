import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { replayCanvasSnapshotHistory } from "@/lib/canvas/projection-rebuild";

describe("canvas projection rebuild", () => {
  it("replays versioned immutable mutations in revision order", () => {
    const rebuilt = replayCanvasSnapshotHistory(createEmptyCanvasDocumentV2(), [
      {
        revision: "2",
        protocolVersion: 1,
        operations: [{
          opId: "create-a", kind: "node.create",
          node: { id: "a", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "old" } },
        }],
      },
      {
        revision: "3",
        protocolVersion: 1,
        operations: [{ opId: "patch-a", kind: "node.patch", nodeId: "a", patch: { data: { text: "new" } } }],
      },
    ]);
    expect(rebuilt.nodes[0].data).toEqual({ kind: "prompt", text: "new" });
  });

  it("rejects a broken revision chain", () => {
    expect(() => replayCanvasSnapshotHistory(createEmptyCanvasDocumentV2(), [{ revision: "4", protocolVersion: 1, operations: [] }], "2"))
      .toThrow("CANVAS_HISTORY_REVISION_GAP");
  });
});
