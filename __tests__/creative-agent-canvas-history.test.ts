import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { createCanvasHistory, pushCanvasHistory, undoCanvasHistory, redoCanvasHistory } from "@/lib/canvas/history";
import { mergeCreativeAgentCanvasDocuments, applyCreativeAgentRemoteHistory } from "@/lib/creative-agent/canvas-history";

const doc = (): CanvasDocumentV2 => ({ ...createEmptyCanvasDocumentV2(), nodes: [
  { id: "p", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", title: "original", text: "base" } },
] });
const clone = (value: CanvasDocumentV2) => structuredClone(value);

describe("Agent remote canvas merge", () => {
  it("merges different paths in one node while preserving a local camera", () => {
    const base = doc(), local = clone(base), remote = clone(base);
    local.nodes[0].position.x = 120; local.viewport.x = 400;
    (remote.nodes[0].data as any).text = "Agent";
    const result = mergeCreativeAgentCanvasDocuments(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.document.nodes[0]).toMatchObject({ position: { x: 120 }, data: { text: "Agent" } });
    expect(result.document.viewport.x).toBe(400);
  });
  it("keeps the current user value when both edit the same field", () => {
    const base = doc(), local = clone(base), remote = clone(base);
    (local.nodes[0].data as any).text = "user"; (remote.nodes[0].data as any).text = "Agent";
    const result = mergeCreativeAgentCanvasDocuments(base, local, remote);
    expect(result.conflicts.map(c => c.key)).toEqual(["node:p"]);
    expect((result.document.nodes[0].data as any).text).toBe("user");
  });
  it("undoes and redoes user position edits without undoing Agent text changes", () => {
    const base = doc(), edited = clone(base), remote = clone(base);
    edited.nodes[0].position.x = 120;
    const history = pushCanvasHistory(createCanvasHistory(base), edited);
    (remote.nodes[0].data as any).text = "Agent";
    remote.nodes[0].position.x = 120;
    const updated = applyCreativeAgentRemoteHistory(history, remote);
    expect(updated.history.past).toHaveLength(1);
    const undone = undoCanvasHistory(updated.history);
    expect(undone.present.nodes[0]).toMatchObject({ position: { x: 0 }, data: { text: "Agent" } });
    expect(redoCanvasHistory(undone).present.nodes[0].position.x).toBe(120);
  });
  it("invalidates a conflicting same-field undo transition and reports it", () => {
    const base = doc(), edited = clone(base), remote = clone(base);
    (edited.nodes[0].data as any).text = "user";
    const history = pushCanvasHistory(createCanvasHistory(base), edited);
    (remote.nodes[0].data as any).text = "Agent";
    const updated = applyCreativeAgentRemoteHistory(history, remote);
    expect(updated.conflicts).toContain("node:p.data.text");
    expect((undoCanvasHistory(updated.history).present.nodes[0].data as any).text).toBe("Agent");
  });
  it("keeps an Agent result when undo used to remove its parent task node", () => {
    const empty = createEmptyCanvasDocumentV2(), added = doc(), remote = clone(added);
    (remote.nodes[0].data as any).text = "Agent result";
    const updated = applyCreativeAgentRemoteHistory(pushCanvasHistory(createCanvasHistory(empty), added), remote);
    expect(undoCanvasHistory(updated.history).present.nodes).toMatchObject([{ id: "p", data: { text: "Agent result" } }]);
  });
  it("applies remote additions/deletions across redo frames without losing unrelated history", () => {
    const base = doc(), moved = clone(base); moved.nodes[0].position.x = 120;
    const history = undoCanvasHistory(pushCanvasHistory(createCanvasHistory(base), moved));
    const remote = clone(base); remote.nodes.push({ id: "new", type: "prompt", position: { x: 20, y: 0 }, data: { kind: "prompt", text: "new" } });
    const updated = applyCreativeAgentRemoteHistory(history, remote);
    expect(updated.history.future).toHaveLength(1);
    expect(redoCanvasHistory(updated.history).present.nodes.map(n => n.id)).toEqual(["p", "new"]);
    const removed = clone(remote); removed.nodes = removed.nodes.filter(n => n.id !== "p");
    expect(redoCanvasHistory(applyCreativeAgentRemoteHistory(updated.history, removed).history).present.nodes.map(n => n.id)).toEqual(["new"]);
  });
});
