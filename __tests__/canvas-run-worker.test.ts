import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2 } from "@/lib/canvas/document";
import { planCanvasRunSteps } from "@/lib/canvas/run-planner";
import { reorderCanvasTaskReferences } from "@/lib/canvas/task-references";
import { insertMediaItem } from "@/lib/media-item-order";
import {
  buildCanvasRunStepSubmission,
  buildCanvasRunStepSuccessPatch,
  classifyGenerationRecord,
} from "@/lib/canvas/run-worker-contract";

describe("canvas run worker contract", () => {
  it("preserves custom GIF dimensions through canvas save and durable submission", () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "task", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: { references: [], batches: [], settings: { model: "gpt-image-2.6-apimart", prompt: "cat waves", aspectRatio: "auto", resolution: "2K", quality: "low", count: 1, outputFormat: "gif", gifSize: "640x432", frameCount: 9, frameDurationMs: 200 } } } }];
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(document)));
    const step = planCanvasRunSteps(saved, { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" })[0];
    expect(buildCanvasRunStepSubmission({ nodeKind: "imageTask", ...step.input })).toMatchObject({ outputFormat: "gif", gifSize: "640x432", frameCount: 9, frameDurationMs: 200 });
  });

  it.each(["default", "none", "low", "medium", "high", "max", "adaptive"] as const)("preserves LLM thinking %s through save and durable submission", thinkingLevel => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "llm", type: "llm", position: { x: 0, y: 0 }, data: { kind: "llm", providerId: "deepseek", model: "deepseek-flash", thinkingLevel, prompt: "test", status: "idle" } }];
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(document)));
    const step = planCanvasRunSteps(saved, { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" })[0];
    expect(buildCanvasRunStepSubmission({ nodeKind: "llm", ...step.input })).toMatchObject({ thinkingLevel });
  });
  it("preserves Google settings through document save and durable worker submission", () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "task", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: { references: [], batches: [], settings: { model: "gemini-3.1-flash-image", prompt: "cat", aspectRatio: "1:8", resolution: "512", quality: "", count: 1, googleThinkingLevel: "high", googleSearchMode: "web_image" } } } }];
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(document)));
    const step = planCanvasRunSteps(saved, { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" })[0];
    expect(buildCanvasRunStepSubmission({ nodeKind: "imageTask", ...step.input })).toMatchObject({ googleThinkingLevel: "high", googleSearchMode: "web_image", resolution: "512", aspectRatio: "1:8" });
  });
  it.each(["flare", "sunburst"])("preserves %s transparency through saving and worker planning", (gptImage25Mode) => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "task", type: "imageTask", position: { x: 0, y: 0 }, data: {
      kind: "imageTask", task: { references: [], batches: [], settings: {
        model: "gpt-image-2.5-apimart", prompt: "chair", gptImage25Mode, background: "transparent", outputFormat: "webp", aspectRatio: "1:1", resolution: "2K", quality: "high", count: 1,
      } },
    } }];
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(document)));
    const step = planCanvasRunSteps(saved, { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" })[0];
    expect(buildCanvasRunStepSubmission({ nodeKind: "imageTask", ...step.input })).toMatchObject({ background: "transparent", outputFormat: "webp", gptImage25Mode });
  });
  describe.each(["imageTask", "videoTask"] as const)("%s insertion ordering", (kind) => {
    it.each(["before", "after"] as const)("retains inserted %s positions and asset bindings after save and server planning", (placement) => {
      const document = createEmptyCanvasDocumentV2();
      document.nodes = [
        ...["a", "b", "c"].map((id) => ({ id, type: "image" as const, position: { x: 0, y: 0 }, data: { kind: "image" as const, url: `/uploads/${id}.png` } })),
        { id: "task", type: kind, position: { x: 500, y: 0 }, data: kind === "imageTask"
          ? { kind, task: { references: [], batches: [], settings: { model: "nano-banana-pro", prompt: "@图片1 靠近 @图片3", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 } } }
          : { kind, model: "minimax-h3", prompt: "@图片1 靠近 @图片3", mediaPaths: [], inputMode: "multimodal", status: "idle" } },
      ];
      document.edges = ["a", "b", "c"].map((id) => ({ id: `edge-${id}`, source: id, target: "task" }));
      const inserted = reorderCanvasTaskReferences(document, "task", insertMediaItem(["a", "b", "c"], 0, 2, placement));
      const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(inserted)));
      const step = planCanvasRunSteps(saved, { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" })[0];
      const submission = buildCanvasRunStepSubmission({ nodeKind: kind, ...step.input });
      const expectedPaths = placement === "before" ? ["/uploads/b.png", "/uploads/a.png", "/uploads/c.png"] : ["/uploads/b.png", "/uploads/c.png", "/uploads/a.png"];
      expect(submission.kind === "image" ? submission.imagePaths : submission.kind === "video" ? submission.mediaPaths : []).toEqual(expectedPaths);
      expect("prompt" in submission && submission.prompt).toBe(placement === "before" ? "@图片2 靠近 @图片3" : "@图片3 靠近 @图片2");
      expect(saved.edges).toEqual(document.edges);
    });
  });

  it.each(["imageTask", "videoTask"] as const)("submits the saved swapped order and matching prompt for %s", (kind) => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [
      ...["a", "b", "c"].map((id) => ({ id, type: "image" as const, position: { x: 0, y: 0 }, data: { kind: "image" as const, url: `/uploads/${id}.png` } })),
      { id: "task", type: kind, position: { x: 500, y: 0 }, data: kind === "imageTask"
        ? { kind, task: { references: [], batches: [], settings: { model: "nano-banana-pro", prompt: "@图片1 靠近 @图片3", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 } } }
        : { kind, model: "seedance", prompt: "@图片1 靠近 @图片3", mediaPaths: [], inputMode: "first_last_frame", status: "idle" } },
    ];
    document.edges = ["a", "b", "c"].map((id) => ({ id: `edge-${id}`, source: id, target: "task" }));
    const swapped = reorderCanvasTaskReferences(document, "task", ["c", "b", "a"]);
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(swapped)));
    const step = planCanvasRunSteps(saved, { scope: "full", nodeIds: [], runRequestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" })[0];
    const submission = buildCanvasRunStepSubmission({ nodeKind: kind, ...step.input });
    expect(submission.kind === "image" ? submission.imagePaths : submission.kind === "video" ? submission.mediaPaths : []).toEqual(["/uploads/c.png", "/uploads/b.png", "/uploads/a.png"]);
    expect("prompt" in submission && submission.prompt).toBe("@图片3 靠近 @图片1");
    expect(saved.edges).toEqual(document.edges);
  });

  it("keeps processing the batch when a step loses its lease during cancellation", () => {
    const worker = readFileSync("lib/canvas/run-worker.ts", "utf8");
    expect(worker).toContain('error.code === "RUN_STEP_LEASE_LOST"');
    expect(worker).toMatch(/for \(const step of queued\) \{[\s\S]*?try \{[\s\S]*?submitStep/);
    expect(worker).toContain('outcomes.push("cancelled")');
  });

  it("maps pinned image task input without reading the live canvas", () => {
    const submission = buildCanvasRunStepSubmission({
      nodeKind: "imageTask",
      node: {
        id: "image-task-1",
        type: "imageTask",
        position: { x: 0, y: 0 },
        data: {
          kind: "imageTask",
          task: {
            references: [{ id: "ref-1", url: "/uploads/ref.png", name: "ref" }],
            settings: { model: "nano-banana-pro", prompt: "draw", aspectRatio: "1:1", resolution: "2K", quality: "high", count: 1 },
            batches: [],
          },
        },
      },
    });

    expect(submission).toEqual({
      kind: "image",
      model: "nano-banana-pro",
      prompt: "draw",
      textList: [],
      aspectRatio: "1:1",
      resolution: "2K",
      quality: "high",
      imagePaths: ["/uploads/ref.png"],
    });
  });

  it("maps video and llm submissions from the pinned node", () => {
    expect(buildCanvasRunStepSubmission({
      nodeKind: "videoTask",
      node: {
        id: "video-1", type: "videoTask", position: { x: 0, y: 0 },
        data: { kind: "videoTask", model: "seedance", prompt: "move", mediaPaths: ["/a.png"], status: "idle", duration: 5, ratio: "16:9" },
      },
    })).toMatchObject({ kind: "video", model: "seedance", prompt: "move", mediaPaths: ["/a.png"], duration: 5, ratio: "16:9" });

    expect(buildCanvasRunStepSubmission({
      nodeKind: "llm",
      node: {
        id: "llm-1", type: "llm", position: { x: 0, y: 0 },
        data: { kind: "llm", providerId: "openai", model: "gpt-test", system: "be brief", prompt: "hello", status: "idle" },
      },
    })).toEqual({ kind: "llm", providerId: "openai", model: "gpt-test", system: "be brief", prompt: "hello", textList: [], mediaReferences: [] });

    expect(buildCanvasRunStepSubmission({
      nodeKind: "audioTask",
      node: {
        id: "audio-1", type: "audioTask", position: { x: 0, y: 0 },
        data: { kind: "audioTask", model: "speech-2.8-hd", prompt: "你好", voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", emotion: "happy", status: "idle" },
      },
    })).toEqual({ kind: "audio", model: "speech-2.8-hd", text: "你好", textList: [], voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", emotion: "happy" });
  });

  it("preserves all Seedance 2.5 references and official options in pinned runs", () => {
    const mediaPaths = Array.from({ length: 50 }, (_, index) => `/reference-${index + 1}.png`);

    expect(buildCanvasRunStepSubmission({
      nodeKind: "videoTask",
      node: {
        id: "video-25", type: "videoTask", position: { x: 0, y: 0 },
        data: {
          kind: "videoTask",
          model: "doubao-seedance-2-5-260628",
          prompt: "extend",
          mediaPaths,
          inputMode: "multimodal",
          ratio: "adaptive",
          duration: 5,
          omniReferenceTaskType: "extend",
          outputFormat: "mov",
          status: "idle",
        },
      },
    })).toMatchObject({
      kind: "video",
      mediaPaths,
      omniReferenceTaskType: "extend",
      outputFormat: "mov",
    });
  });

  it("classifies provider records without resubmitting unknown work", () => {
    expect(classifyGenerationRecord({ status: "success", localPath: "/uploads/out.png", errorMsg: null })).toEqual({ kind: "success", url: "/uploads/out.png" });
    expect(classifyGenerationRecord({ status: "failed", localPath: null, errorMsg: "bad input" })).toEqual({ kind: "failed", error: "bad input" });
    expect(classifyGenerationRecord({ status: "running", localPath: null, errorMsg: null })).toEqual({ kind: "waiting" });
  });

  it("builds deterministic node patches for idempotent output application", () => {
    expect(buildCanvasRunStepSuccessPatch({
      runId: 9,
      stepId: "12",
      nodeKind: "llm",
      pinnedNodeData: { kind: "llm", providerId: "openai", model: "gpt-test", prompt: "hello", status: "idle" },
      output: { text: "world" },
      finishedAt: 123,
    })).toEqual({ data: { output: "world", status: "success" }, unsetDataKeys: ["error"] });

    const imagePatch = buildCanvasRunStepSuccessPatch({
      runId: 9,
      stepId: "12",
      nodeKind: "imageTask",
      pinnedNodeData: {
        kind: "imageTask",
        task: { references: [], settings: { model: "m", prompt: "p", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 }, batches: [] },
      },
      output: { url: "/uploads/out.png", generationId: 44 },
      finishedAt: 123,
    });
    expect((imagePatch.data as Record<string, any>)?.task).toMatchObject({
      batches: [{ id: "run-9-step-12", outputs: [{ id: "run-9-step-12-output-0", generationId: 44, status: "success", url: "/uploads/out.png" }] }],
    });

    expect(buildCanvasRunStepSuccessPatch({
      runId: 9,
      stepId: "13",
      nodeKind: "audioTask",
      pinnedNodeData: { kind: "audioTask", model: "speech-2.8-hd", prompt: "你好", voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "idle" },
      output: { url: "/uploads/out.mp3", generationId: 45, durationSeconds: 1.2, usageCharacters: 2 },
      finishedAt: 124,
    })).toMatchObject({ data: { outputUrl: "/uploads/out.mp3", generationId: 45, durationSeconds: 1.2, usageCharacters: 2, status: "success" } });
  });
});
