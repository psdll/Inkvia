import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { collectCanvasTextReferences, composeCanvasModelPrompt } from "@/lib/canvas/text-references";
import { buildCanvasTaskMediaInput, disconnectCanvasEdge } from "@/lib/canvas/task-references";
import { buildCanvasRunStepSubmission } from "@/lib/canvas/run-worker-contract";

function graph(): CanvasDocumentV2 {
  return { ...createEmptyCanvasDocumentV2(), nodes: [
    { id: "text", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", title: "人物", text: "人物保留", format: "markdown" } },
    { id: "result", type: "llm", position: { x: 0, y: 0 }, data: { kind: "llm", prompt: "不应该传给下游", output: "背景保留", status: "success" } },
    { id: "image", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/ref.png" } },
    { id: "task", type: "videoTask", position: { x: 0, y: 0 }, data: { kind: "videoTask", prompt: "去除按摩椅", model: "", mediaPaths: [], status: "idle" } },
  ], edges: [
    { id: "a", source: "text", target: "task" }, { id: "b", source: "result", target: "task" },
    { id: "c", source: "image", target: "task" }, { id: "duplicate", source: "text", target: "task" },
  ] };
}

describe("canvas text references", () => {
  it("keeps empty text cards for display without sending empty references to generation", () => {
    const document = graph();
    if (document.nodes[0].data.kind === "prompt") document.nodes[0].data.text = "";
    if (document.nodes[1].data.kind === "llm") document.nodes[1].data.output = undefined;
    expect(collectCanvasTextReferences(document, "task", true).map(({ id, content }) => ({ id, content }))).toEqual([{ id: "text", content: "" }, { id: "result", content: "" }]);
    expect(buildCanvasTaskMediaInput(document, "task", "描述").textList).toEqual([]);
    if (document.nodes[1].data.kind === "llm") document.nodes[1].data.output = "生成结果";
    expect(collectCanvasTextReferences(document, "task", true)[1].content).toBe("生成结果");
  });
  it("keeps connected text separate from the local prompt and media, following edits", () => {
    const document = graph();
    expect(buildCanvasTaskMediaInput(document, "task", "去除按摩椅")).toEqual({ prompt: "去除按摩椅", textList: ["人物保留", "背景保留"], imagePaths: ["/ref.png"], mediaPaths: ["/ref.png"] });
    if (document.nodes[0].data.kind === "prompt") document.nodes[0].data.text = "新内容";
    expect(collectCanvasTextReferences(document, "task")[0]).toMatchObject({ id: "text", content: "新内容" });
    const disconnected = disconnectCanvasEdge(disconnectCanvasEdge(document, "a"), "duplicate");
    expect(buildCanvasTaskMediaInput(disconnected, "task", "去除按摩椅").textList).toEqual(["背景保留"]);
    expect(disconnected.nodes[0].data).toEqual(document.nodes[0].data);
  });
  it("uses the same separate inputs for a server run and adapts once at the provider boundary", () => {
    const document = graph();
    const submission = buildCanvasRunStepSubmission({ nodeKind: "videoTask", node: document.nodes[3], incomingNodes: document.nodes.slice(0, 3), incomingEdges: document.edges });
    expect(submission).toMatchObject({ prompt: "去除按摩椅", textList: ["人物保留", "背景保留"] });
    expect(composeCanvasModelPrompt("去除按摩椅", ["人物保留", "背景保留"])).toBe("去除按摩椅人物保留背景保留");
    expect(composeCanvasModelPrompt("", ["人物保留"])).toBe("人物保留");
    expect(composeCanvasModelPrompt("原有提示词", undefined)).toBe("原有提示词");
  });
});
