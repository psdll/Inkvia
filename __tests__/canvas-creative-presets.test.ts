import { describe, expect, it } from "vitest";
import { composeCanvasCreativePrompt } from "@/lib/canvas/creative-presets/compose";
import { defaultImageAngle, normalizeImageAngle } from "@/lib/canvas/creative-presets/angle";
import { createCanvasAngleTask } from "@/lib/canvas/creative-presets/create-angle-task";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2 } from "@/lib/canvas/document";
import { collectCanvasTaskAssets } from "@/lib/canvas/task-references";
import { duplicateSelection } from "@/lib/canvas/graph";
import { appendCanvasDocument } from "@/lib/canvas/transfer";
import { collectWorkflowResources } from "@/lib/canvas/workflow-archive";
import { planCanvasRunSteps } from "@/lib/canvas/run-planner";
import { buildCanvasRunStepSubmission } from "@/lib/canvas/run-worker-contract";

const settings = { model: "gpt-image-2.5-reapi", prompt: "原始正文", aspectRatio: "16:9", resolution: "2K", quality: "high", count: 2 };
const legacyPresets = { motionId: "motion-645", styleId: "style-643" };

describe("canvas creative presets", () => {
  it("preserves the old prompt when no feature is selected", () => {
    expect(composeCanvasCreativePrompt({ kind: "image", prompt: "正文", textList: ["参考文字"] })).toBe("正文参考文字");
  });
  it("drops retired preset selections and tags without mutating editor text", () => {
    const input = { kind: "video" as const, prompt: "[[motion:motion-645]]正文", textList: ["参考文字"], creativePresets: legacyPresets };
    expect(composeCanvasCreativePrompt(input)).toBe("正文参考文字");
    expect(input.prompt).toBe("[[motion:motion-645]]正文");
  });
  it("accepts presets without text, preserves precise angles, and supports fisheye", () => {
    const result = composeCanvasCreativePrompt({ kind: "image", prompt: "", imageAngle: { azimuth: 345, elevation: 60, zoom: 5.3, lens: "fisheye" } });
    expect(result).toContain("345°"); expect(result).toContain("60°"); expect(result).toContain("5.3/10"); expect(result).toContain("鱼眼");
    expect(normalizeImageAngle({ azimuth: -15, elevation: 100, zoom: 11 })).toMatchObject({ azimuth: 345, elevation: 90, zoom: 10 });
  });
  it("rejects malformed preset settings and invalid angles", () => {
    expect(() => composeCanvasCreativePrompt({ kind: "image", prompt: "x", creativePresets: "injected" })).toThrow();
    expect(() => composeCanvasCreativePrompt({ kind: "image", prompt: "x", imageAngle: { ...defaultImageAngle, azimuth: 360 } })).toThrow();
    expect(() => composeCanvasCreativePrompt({ kind: "video", prompt: "x", imageAngle: defaultImageAngle })).toThrow();
    expect(composeCanvasCreativePrompt({ kind: "video", prompt: "x", creativePresets: legacyPresets, cameraFixed: true })).toBe("x");
  });
  it.each(["imageTask", "videoTask"] as const)("persists %s selections through workflow planning without polluting references", kind => {
    const doc = createEmptyCanvasDocumentV2();
    doc.nodes = [{ id: "source", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/uploads/source.png" } },
      { id: "task", type: kind, position: { x: 400, y: 0 }, data: kind === "imageTask"
        ? { kind, task: { references: [], batches: [], settings: { ...settings, imageAngle: defaultImageAngle } } }
        : { kind, model: "minimax-h3", prompt: settings.prompt, status: "idle", mediaPaths: [], creativePresets: legacyPresets } }];
    doc.edges = [{ id: "edge", source: "source", target: "task" }];
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(doc)));
    expect(collectCanvasTaskAssets(saved, "task").map(p => [p.url, p.token])).toEqual([["/uploads/source.png", "图片1"]]);
    const step = planCanvasRunSteps(saved, { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" })[0];
    const submission = buildCanvasRunStepSubmission({ nodeKind: kind, ...step.input });
    expect(submission).toMatchObject({ prompt: settings.prompt });
    if (submission.kind !== "image" && submission.kind !== "video") throw new Error("Unexpected kind");
    expect(composeCanvasCreativePrompt(submission)).toContain(settings.prompt);
  });
  it("creates a separate angle task pinned to the clicked batch output through save, copy and disconnect", () => {
    const doc = createEmptyCanvasDocumentV2();
    doc.nodes = [{ id: "source", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: { settings, references: [], batches: [{ id: "b", createdAt: 1, settings, outputs: ["first", "second"].map(id => ({ id, status: "success" as const, url: `/uploads/${id}.png`, index: 0 })) }] } } }];
    const original = JSON.stringify(doc);
    const next = parseCanvasDocumentV2(JSON.parse(JSON.stringify(createCanvasAngleTask(doc, { sourceId: "source", url: "/uploads/second.png", angle: defaultImageAngle, settings, nodeId: "angle", edgeId: "edge" }))));
    expect(JSON.stringify(doc)).toBe(original);
    expect(next.nodes[1].data.kind === "imageTask" && next.nodes[1].data.task.settings.prompt).toBe("");
    const supplemental = "保持材质\ndutch angle，tilted frame";
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(createCanvasAngleTask(doc, { sourceId: "source", url: "/uploads/second.png", angle: defaultImageAngle, settings, prompt: supplemental, nodeId: "angle", edgeId: "edge" }))));
    const savedTask = saved.nodes[1].data;
    if (savedTask.kind !== "imageTask") throw new Error("Expected image task");
    expect(savedTask.task.settings.prompt).toBe(supplemental);
    expect(savedTask.task.settings.imageAngle).toEqual(defaultImageAngle);
    expect(composeCanvasCreativePrompt({ kind: "image", ...savedTask.task.settings })).toContain(supplemental);
    expect(collectCanvasTaskAssets(next, "angle").map(p => p.url)).toEqual(["/uploads/second.png"]);
    const copied = duplicateSelection(next, ["source", "angle"]);
    expect(collectCanvasTaskAssets(copied.document, copied.idMap.get("angle")!).map(p => p.url)).toEqual(["/uploads/second.png"]);
    const imported = appendCanvasDocument(createEmptyCanvasDocumentV2(), next);
    expect(collectCanvasTaskAssets(imported, imported.nodes[1].id).map(p => p.url)).toEqual(["/uploads/second.png"]);
    expect(collectWorkflowResources({ ...next, nodes: next.nodes.filter(node => node.id === "angle") })).toEqual([{ url: "/uploads/second.png", kind: "image" }]);
    expect(collectCanvasTaskAssets({ ...next, edges: [] }, "angle")).toEqual([]);
    expect(() => createCanvasAngleTask(doc, { sourceId: "source", url: "/uploads/unrelated.png", angle: defaultImageAngle, settings, nodeId: "x", edgeId: "y" })).toThrow();
  });
});
