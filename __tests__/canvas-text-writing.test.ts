import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { startCanvasTextWriting } from "@/lib/canvas/text-node";
import { collectNodeInputs } from "@/lib/canvas/execution";
import { createCanvasHistory, pushCanvasHistory, undoCanvasHistory, redoCanvasHistory } from "@/lib/canvas/history";
import { diffCanvasDocumentsToOperations } from "@/lib/canvas/document-diff";
import { applyCanvasOperations } from "@/lib/canvas/operations";

const initial = (): CanvasDocumentV2 => ({ ...createEmptyCanvasDocumentV2(), nodes: [
  { id: "text", type: "llm", position: { x: 42, y: 84 }, data: { kind: "llm", prompt: "", status: "idle" } },
  { id: "video", type: "videoTask", position: { x: 500, y: 84 }, data: { kind: "videoTask", prompt: "", model: "minimax-h3", mediaPaths: [], status: "idle" } },
], edges: [{ id: "edge", source: "text", target: "video" }] });

describe("manual canvas text writing", () => {
  it("persists frame color through operations and reload and supports undo", () => {
    const before = startCanvasTextWriting(initial(), "text");
    const after: CanvasDocumentV2 = { ...before, nodes: before.nodes.map(node => node.data.kind === "prompt" ? { ...node, data: { ...node.data, backgroundColor: "#ef4444" } } : node) };
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(applyCanvasOperations(before, diffCanvasDocumentsToOperations(before, after)))));
    expect(saved.nodes[0].data).toMatchObject({ backgroundColor: "#ef4444", text: "" });
    const history = pushCanvasHistory(createCanvasHistory(before), after);
    expect(undoCanvasHistory(history).present.nodes[0].data).not.toHaveProperty("backgroundColor");
    expect(redoCanvasHistory(undoCanvasHistory(history)).present.nodes[0].data).toMatchObject({ backgroundColor: "#ef4444" });
  });
  it("turns the same node into editable text and retains its position and connections", () => {
    const before = initial();
    const after = startCanvasTextWriting(before, "text");
    expect(after.nodes[0]).toMatchObject({ id: "text", type: "prompt", position: before.nodes[0].position, width: 350, height: 200, data: { kind: "prompt", text: "", format: "markdown", title: "文本节点 1" } });
    expect(after.edges).toBe(before.edges);
    expect(after.nodes[1]).toBe(before.nodes[1]);
    expect(before.nodes[0].data.kind).toBe("llm");
    expect(applyCanvasOperations(before, diffCanvasDocumentsToOperations(before, after))).toEqual(after);
  });
  it("saves Markdown and feeds authored text to a connected task after reload", () => {
    const after = startCanvasTextWriting(initial(), "text");
    if (after.nodes[0].data.kind !== "prompt") throw new Error("Missing text");
    after.nodes[0].data.text = "# 标题\n\n**重点**\n\n- 第一项";
    const reloaded = parseCanvasDocumentV2(JSON.parse(JSON.stringify(after)));
    expect(reloaded.nodes[0].data).toEqual(after.nodes[0].data);
    expect(collectNodeInputs(reloaded, "video").prompts).toEqual([after.nodes[0].data.text]);
  });
  it("allows canvas undo and redo of writing mode and manual content", () => {
    const before = initial();
    const writing = startCanvasTextWriting(before, "text");
    const history = pushCanvasHistory(createCanvasHistory(before), writing);
    expect(undoCanvasHistory(history).present.nodes[0].data.kind).toBe("llm");
    expect(redoCanvasHistory(undoCanvasHistory(history)).present).toEqual(writing);
  });
  it("cannot turn a running text generation into a manual node", () => {
    const document = initial();
    if (document.nodes[0].data.kind === "llm") document.nodes[0].data.status = "running";
    expect(startCanvasTextWriting(document, "text")).toBe(document);
  });
});
