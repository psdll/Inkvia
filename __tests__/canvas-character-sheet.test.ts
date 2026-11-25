import { describe, expect, it } from "vitest";
import { buildCanvasCharacterSheetPrompt, CANVAS_CHARACTER_SHEET_PROMPT, createCanvasCharacterSheetTask } from "@/lib/canvas/character-sheet";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2 } from "@/lib/canvas/document";
import { collectCanvasTaskAssets } from "@/lib/canvas/task-references";
import { buildCanvasRunStepSubmission } from "@/lib/canvas/run-worker-contract";
import { CHARACTER_SHEET_TOKEN } from "@/lib/canvas/creative-presets/inline-token";
import { editorDocToPromptText, promptTextToEditorDoc } from "@/lib/prompt-rich-editor-content";

const settings = { model: "gpt-image-2.5-reapi", prompt: "旧提示词", aspectRatio: "3:4", resolution: "2K", quality: "high", count: 2 };

describe("canvas character sheet", () => {
  it("creates an ordinary connected image task pinned to the clicked output", () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "source", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: {
      references: [], settings, batches: [{ id: "batch", createdAt: 1, settings, outputs: ["first", "second"].map((name, index) => ({ id: name, index, status: "success" as const, url: `/uploads/${name}.png` })) }],
    } } }];
    const next = parseCanvasDocumentV2(JSON.parse(JSON.stringify(createCanvasCharacterSheetTask(document, {
      sourceId: "source", url: "/uploads/second.png", settings, nodeId: "sheet", edgeId: "edge",
    }))));
    const node = next.nodes.find((item) => item.id === "sheet")!;
    expect(node.data.kind).toBe("imageTask");
    if (node.data.kind !== "imageTask") throw new Error("Expected image task");
    expect(node.data.task).toMatchObject({ preset: "characterSheet", settings: { prompt: CHARACTER_SHEET_TOKEN, aspectRatio: "16:9", resolution: "2K", quality: "high", count: 2 } });
    expect(next.edges.at(-1)).toMatchObject({ source: "source", target: "sheet" });
    expect(collectCanvasTaskAssets(next, "sheet").map((asset) => asset.url)).toEqual(["/uploads/second.png"]);
    expect(() => createCanvasCharacterSheetTask(document, { sourceId: "source", url: "/uploads/other.png", settings, nodeId: "bad", edgeId: "bad-edge" })).toThrow();
  });

  it("appends editable requirements to the built-in prompt and submits only 16:9", () => {
    expect(buildCanvasCharacterSheetPrompt(`${CHARACTER_SHEET_TOKEN}\n保留痣`)).toBe(`${CANVAS_CHARACTER_SHEET_PROMPT}\n\n保留痣`);
    expect(buildCanvasCharacterSheetPrompt("")).toBe(CANVAS_CHARACTER_SHEET_PROMPT);
    const editorDoc = promptTextToEditorDoc(`${CHARACTER_SHEET_TOKEN}\n保留痣`, [], null, true);
    expect(editorDoc.content[0].content?.[0]).toMatchObject({ type: "motionMention", attrs: { presetId: "characterSheet-0", name: "角色设定图" } });
    expect(editorDocToPromptText(editorDoc)).toBe(`${CHARACTER_SHEET_TOKEN}\n保留痣`);
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "source", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/uploads/person.png" } }];
    const next = createCanvasCharacterSheetTask(document, { sourceId: "source", url: "/uploads/person.png", settings, nodeId: "sheet", edgeId: "edge" });
    const sheet = next.nodes[1];
    if (sheet.data.kind !== "imageTask") throw new Error("Expected image task");
    sheet.data.task.settings = { ...sheet.data.task.settings, prompt: `${CHARACTER_SHEET_TOKEN}\n保留痣`, aspectRatio: "3:4" };
    const submission = buildCanvasRunStepSubmission({ nodeKind: "imageTask", node: sheet, incomingNodes: [next.nodes[0]], incomingEdges: next.edges });
    expect(submission).toMatchObject({ kind: "image", prompt: `${CANVAS_CHARACTER_SHEET_PROMPT}\n\n保留痣`, aspectRatio: "16:9", imagePaths: ["/uploads/person.png"] });
    sheet.data.task.preset = undefined;
    sheet.data.task.settings = { ...sheet.data.task.settings, prompt: "保留痣", aspectRatio: "3:4" };
    expect(buildCanvasRunStepSubmission({ nodeKind: "imageTask", node: sheet, incomingNodes: [next.nodes[0]], incomingEdges: next.edges }))
      .toMatchObject({ kind: "image", prompt: "保留痣", aspectRatio: "3:4" });
  });
});
