import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createVideoTaskSchema } from "@/lib/generation/task-input-schema";

describe("official MiniMax-H3 generation entrypoints", () => {
  it("dispatches the shared video service to the official async adapter", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/generation/video-service.ts"), "utf8");
    const dispatch = source.indexOf("if (isMiniMaxH3VideoModel(model))");
    const volcengineFallback = source.indexOf("if (!isVolcengineVideoModel(model))");

    expect(source).toContain('from "@/lib/minimax-video"');
    expect(source).toContain("miniMaxSubmitVideo({");
    expect(source).toContain("assertMiniMaxH3ConcurrencyAvailable(tx, model)");
    expect(source).toContain('externalProvider: "minimax"');
    expect(source).not.toContain("aicomingHaiyaSubmitVideo({");
    expect(dispatch).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(volcengineFallback);
  });

  it("keeps the video tool, canvas and live batch on the shared catalog/service path", () => {
    const videoTool = readFileSync(resolve(process.cwd(), "app/video/video-tool.tsx"), "utf8");
    const canvasNode = readFileSync(resolve(process.cwd(), "components/canvas/CanvasNodeCard.tsx"), "utf8");
    const canvasRoute = readFileSync(resolve(process.cwd(), "app/api/canvas/generate-video/route.ts"), "utf8");
    const liveBatchService = readFileSync(resolve(process.cwd(), "lib/live-video-batch/service.ts"), "utf8");
    const liveBatchWorker = readFileSync(resolve(process.cwd(), "lib/live-video-batch/video-worker.ts"), "utf8");

    expect(videoTool).toContain("sora2Models");
    expect(canvasNode).toContain("isMiniMaxH3VideoModel(model)");
    expect(canvasNode).toContain("resolveCanvasVideoInputMode(data.inputMode, spec, videoReferences)");
    expect(canvasNode).toContain("isMiniMaxH3 && inputModeValue === \"text_to_video\"");
    expect(canvasRoute).toContain("createVideoGeneration");
    expect(liveBatchService).toContain("getSeedanceUploadContract(settings.model) || getMiniMaxH3UploadContract(settings.model)");
    expect(liveBatchWorker).toContain("createVideoGeneration");
  });

  it("shows only supported H3 controls without adding a tail-only input mode", () => {
    const videoTool = readFileSync(resolve(process.cwd(), "app/video/video-tool.tsx"), "utf8");
    const clientDraft = readFileSync(resolve(process.cwd(), "lib/tool-media/client-draft.ts"), "utf8");

    expect(videoTool).toContain("const isMiniMaxH3 = isMiniMaxH3VideoModel(model);");
    expect(videoTool).not.toContain("控制水印");
    expect(videoTool).not.toContain('label="返回尾帧图"');
    expect(videoTool).not.toContain("随机种子");
    expect(videoTool).not.toContain('label="水印"');
    expect(videoTool).toMatch(/\{modelSpec\.provider !== "kie" && !isMiniMaxH3 && !isWan && \(\s*<button/);
    expect(videoTool).toMatch(/\{modelSpec\.provider !== "kie" && !isMiniMaxH3 && !isWan &&\s*\(advOpen \? \(/);
    expect(videoTool).not.toContain('mode === "last_frame"');
    expect(clientDraft).toContain("getMiniMaxH3UploadContract");
  });

  it("allows the agent video entrypoint to carry the two H3 resolutions", () => {
    const schema = readFileSync(resolve(process.cwd(), "lib/generation/task-input-schema.ts"), "utf8");

    expect(schema).toContain('"768p", "2k"');
  });

  it("uses 768p only as the official H3 agent default and preserves the existing 720p default", () => {
    expect(createVideoTaskSchema.parse({
      prompt: "test H3",
      model: "minimax-h3",
    })).toMatchObject({ resolution: "768p" });
    expect(createVideoTaskSchema.parse({
      prompt: "test Seedance",
      model: "doubao-seedance-2-0-260128",
    })).toMatchObject({ resolution: "720p" });
  });
});
