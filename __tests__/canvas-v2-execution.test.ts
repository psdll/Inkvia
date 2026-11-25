import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { collectNodeInputs, createImageTaskBatch, updateImageTaskOutput } from "@/lib/canvas/execution";

function graph(): CanvasDocumentV2 {
  return {
    ...createEmptyCanvasDocumentV2(),
    nodes: [
      { id: "prompt", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "cinematic light" } },
      { id: "llm", type: "llm", position: { x: 0, y: 100 }, data: { kind: "llm", prompt: "", output: "a glass city", status: "success" } },
      { id: "image", type: "image", position: { x: 0, y: 200 }, data: { kind: "image", url: "/uploads/ref.png" } },
      { id: "task", type: "imageTask", position: { x: 300, y: 0 }, data: { kind: "imageTask", task: { references: [{ id: "r1", url: "/uploads/direct.png", name: "direct" }], settings: { model: "model", prompt: "local prompt", aspectRatio: "1:1", resolution: "2K", quality: "", count: 2 }, batches: [] } } },
    ],
    edges: [
      { id: "e1", source: "prompt", target: "task" },
      { id: "e2", source: "llm", target: "task" },
      { id: "e3", source: "image", target: "task" },
    ],
  };
}

describe("canvas v2 execution adapter", () => {
  it("collects typed upstream prompts and media without duplicates", () => {
    expect(collectNodeInputs(graph(), "task")).toEqual({
      prompts: ["cinematic light", "a glass city"],
      imageUrls: ["/uploads/ref.png"],
      videoUrls: [],
      audioUrls: [],
    });
  });

  it("creates independent output slots and updates only the selected slot", () => {
    const taskNode = graph().nodes.find((node) => node.id === "task")!;
    if (taskNode.data.kind !== "imageTask") throw new Error("invalid fixture");
    let sequence = 0;
    const batch = createImageTaskBatch(taskNode.data.task.settings, 100, (prefix) => `${prefix}-${sequence += 1}`);
    expect(batch.outputs).toHaveLength(2);
    expect(batch.outputs.every((output) => output.status === "idle")).toBe(true);

    const updated = updateImageTaskOutput(batch, batch.outputs[1].id, { status: "failed", error: "timeout" });
    expect(updated.outputs[0].status).toBe("idle");
    expect(updated.outputs[1]).toMatchObject({ status: "failed", error: "timeout" });
  });

  it("normalizes legacy automatic quality before creating a new batch", () => {
    const batch = createImageTaskBatch({
      model: "gpt-image-2-apimart",
      prompt: "portrait",
      aspectRatio: "1:1",
      resolution: "2K",
      quality: "auto",
      count: 1,
    }, 100, (prefix) => `${prefix}-1`);

    expect(batch.settings.quality).toBe("medium");
  });
});
