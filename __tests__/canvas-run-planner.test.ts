import { describe, expect, it } from "vitest";
import { deriveCanvasStepRequestKey, planCanvasRunSteps } from "@/lib/canvas/run-planner";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";

function workflow() {
  const document = createEmptyCanvasDocumentV2();
  document.nodes = [
    { id: "prompt", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "hello" } },
    { id: "image", type: "imageTask", position: { x: 100, y: 0 }, data: { kind: "imageTask", task: {} as any } },
    { id: "llm", type: "llm", position: { x: 200, y: 0 }, data: { kind: "llm", prompt: "describe", status: "idle" } },
  ];
  document.edges = [
    { id: "a", source: "prompt", target: "image" },
    { id: "b", source: "image", target: "llm" },
  ];
  return document;
}

describe("canvas run planner", () => {
  it("pins executable steps and their input dependencies", () => {
    const steps = planCanvasRunSteps(workflow(), { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" });
    expect(steps.map((step) => step.nodeId)).toEqual(["image", "llm"]);
    expect(steps[0]?.dependencies).toEqual([]);
    expect(steps[1]?.dependencies).toEqual(["image"]);
    expect(steps[0]?.input).toMatchObject({ node: { id: "image" }, incomingNodes: [{ id: "prompt" }] });
  });

  it("selects downstream executable nodes from a material source", () => {
    const steps = planCanvasRunSteps(workflow(), { scope: "downstream", nodeIds: ["prompt"], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" });
    expect(steps.map((step) => step.nodeId)).toEqual(["image", "llm"]);
  });

  it("derives stable distinct UUID request keys", () => {
    const first = deriveCanvasStepRequestKey("d31782e3-d0fb-4aa1-9096-a7d16878cd55", "node-a");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).toBe(deriveCanvasStepRequestKey("d31782e3-d0fb-4aa1-9096-a7d16878cd55", "node-a"));
    expect(first).not.toBe(deriveCanvasStepRequestKey("d31782e3-d0fb-4aa1-9096-a7d16878cd55", "node-b"));
  });

  it("plans audio generation nodes as executable steps", () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{
      id: "audio",
      type: "audioTask",
      position: { x: 0, y: 0 },
      data: { kind: "audioTask", model: "speech-2.8-hd", prompt: "hello", voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "idle" },
    }];
    expect(planCanvasRunSteps(document, { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" }).map((step) => step.nodeId)).toEqual(["audio"]);
  });
});
