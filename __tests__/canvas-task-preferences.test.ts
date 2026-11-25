import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { CanvasNodeData } from "@/lib/canvas/document";
import {
  applyCanvasTaskPreferences,
  carryCanvasImageTaskSettingsToModel,
  normalizeCanvasVideoTaskForModel,
  readCanvasTaskPreferences,
  rememberCanvasTaskPreferences,
  restoreCanvasImageModelPreference,
  restoreCanvasVideoModelPreference,
  writeCanvasTaskPreferences,
} from "@/lib/canvas/task-preferences";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";
import { getVideoModelSpec } from "@/lib/sora2";

function imageTask(overrides: Partial<Extract<CanvasNodeData, { kind: "imageTask" }>["task"]["settings"]> = {}): Extract<CanvasNodeData, { kind: "imageTask" }> {
  return {
    kind: "imageTask",
    task: {
      references: [],
      settings: { model: "", prompt: "", aspectRatio: "auto", resolution: "2K", quality: "", count: 1, ...overrides },
      batches: [],
    },
  };
}

function videoTask(overrides: Partial<Extract<CanvasNodeData, { kind: "videoTask" }>> = {}): Extract<CanvasNodeData, { kind: "videoTask" }> {
  return {
    kind: "videoTask",
    model: "",
    prompt: "",
    mediaPaths: [],
    inputMode: "multimodal",
    resolution: "480p",
    ratio: "adaptive",
    duration: -1,
    status: "idle",
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("canvas task preferences", () => {
  it("restores Google quality and search per model and clears unsupported settings on switch", () => {
    const task = imageTask({ model: "gemini-nano-banana-2.1", googleThinkingLevel: "high", googleSearchMode: "web_image" });
    const storage = memoryStorage();
    writeCanvasTaskPreferences(storage, 7, rememberCanvasTaskPreferences({}, task));
    const preferences = readCanvasTaskPreferences(storage, 7);
    const restored = restoreCanvasImageModelPreference(imageTask(), "gemini-nano-banana-2.1", getCanvasImageModelParams("gemini-nano-banana-2.1"), preferences);
    expect(restored.task.settings).toMatchObject({ googleThinkingLevel: "high", googleSearchMode: "web_image" });
    const pro = carryCanvasImageTaskSettingsToModel(task, "gemini-3-pro-image", getCanvasImageModelParams("gemini-3-pro-image"));
    expect(pro.task.settings.googleThinkingLevel).toBeUndefined();
    expect(pro.task.settings.googleSearchMode).toBe("off");
  });
  it("carries OpenRouter transparent output settings only to models supporting them", () => {
    const source = imageTask({ model: "gpt-image-2.5-flare-openrouter", aspectRatio: "16:9", resolution: "4K", quality: "max", background: "transparent", outputFormat: "png" });
    const pro = carryCanvasImageTaskSettingsToModel(source, "gpt-image-2.5-sunburst-openrouter", getCanvasImageModelParams("gpt-image-2.5-sunburst-openrouter"));
    expect(pro.task.settings).toMatchObject({ background: "transparent", resolution: "4K", aspectRatio: "16:9", quality: "max" });
    const gpt2 = carryCanvasImageTaskSettingsToModel(source, "gpt-image-2-openrouter", getCanvasImageModelParams("gpt-image-2-openrouter"));
    expect(gpt2.task.settings).toMatchObject({ background: undefined, quality: "medium" });
  });
  it("remembers the GPT Image 2.5 mode and max quality across model switches", () => {
    const task = imageTask({ model: "gpt-image-2.5-apimart", quality: "max", gptImage25Mode: "sunburst", background: "transparent", outputFormat: "webp", resolution: "4K" });
    const storage = memoryStorage();
    writeCanvasTaskPreferences(storage, 7, rememberCanvasTaskPreferences({}, task));
    const preferences = readCanvasTaskPreferences(storage, 7);
    expect(restoreCanvasImageModelPreference(imageTask(), "gpt-image-2.5-apimart", getCanvasImageModelParams("gpt-image-2.5-apimart"), preferences)).toMatchObject({ task: { settings: { quality: "max", gptImage25Mode: "sunburst", background: "transparent", outputFormat: "webp", resolution: "4K" } } });
  });

  it("keeps successful image settings isolated by model", () => {
    const nano = imageTask({ model: "nano-banana-pro", aspectRatio: "16:9", resolution: "4K", count: 2 });
    const gpt = imageTask({ model: "gpt-image-2", aspectRatio: "1:1", resolution: "2K", quality: "high", count: 4 });

    const afterNano = rememberCanvasTaskPreferences({}, nano);
    const preferences = rememberCanvasTaskPreferences(afterNano, gpt);

    expect(preferences).toMatchObject({
      image: {
        lastModel: "gpt-image-2",
        byModel: {
          "nano-banana-pro": { aspectRatio: "16:9", resolution: "4K", count: 2 },
          "gpt-image-2": { aspectRatio: "1:1", resolution: "2K", quality: "high", count: 4 },
        },
      },
    });
    expect(restoreCanvasImageModelPreference(imageTask(), "nano-banana-pro", getCanvasImageModelParams("nano-banana-pro"), preferences)).toMatchObject({
      task: { settings: { model: "nano-banana-pro", aspectRatio: "16:9", resolution: "4K", count: 2 } },
    });
  });

  it("carries current image parameters to a new model when supported", () => {
    const current = imageTask({ model: "gpt-image-2-apimart", aspectRatio: "16:9", resolution: "4K", quality: "high", count: 3 });
    const switched = carryCanvasImageTaskSettingsToModel(current, "gpt-image-2-apimart", getCanvasImageModelParams("gpt-image-2-apimart"));

    expect(switched.task.settings).toMatchObject({ model: "gpt-image-2-apimart", aspectRatio: "16:9", resolution: "4K", quality: "high", count: 3 });
    expect(switched.task.settings.prompt).toBe(current.task.settings.prompt);
  });

  it("replaces only image parameters unavailable on the new model", () => {
    const current = imageTask({ model: "nano-banana-2", aspectRatio: "4:1", resolution: "4K", count: 3 });
    const params = getCanvasImageModelParams("nano-banana-pro");
    const switched = carryCanvasImageTaskSettingsToModel(current, "nano-banana-pro", params);

    expect(switched.task.settings).toMatchObject({
      model: "nano-banana-pro",
      aspectRatio: params.defaultAspectRatio,
      resolution: "4K",
      count: 3,
    });

    const lite = carryCanvasImageTaskSettingsToModel(current, "nano-banana-2-lite", getCanvasImageModelParams("nano-banana-2-lite"));
    expect(lite.task.settings).toMatchObject({
      aspectRatio: "4:1",
      resolution: "1K",
      count: 3,
    });
  });

  it("keeps a supported ratio when the target model disallows its old resolution combination", () => {
    const current = imageTask({ model: "nano-banana-pro", aspectRatio: "3:4", resolution: "4K", count: 2 });
    const switched = carryCanvasImageTaskSettingsToModel(current, "gpt-image-2-apimart", getCanvasImageModelParams("gpt-image-2-apimart"));

    expect(switched.task.settings).toMatchObject({ aspectRatio: "3:4", resolution: "4K", count: 2 });
  });

  it("keeps successful video settings isolated by model", () => {
    const h3 = videoTask({ model: "minimax-h3", inputMode: "multimodal", resolution: "768p", ratio: "16:9", duration: 15 });
    const h3Max = videoTask({ model: "minimax-h3-max", inputMode: "first_last_frame", resolution: "768p", ratio: "adaptive", duration: 10 });

    const afterH3 = rememberCanvasTaskPreferences({}, h3);
    const preferences = rememberCanvasTaskPreferences(afterH3, h3Max);

    expect(preferences).toMatchObject({
      video: {
        lastModel: "minimax-h3-max",
        byModel: {
          "minimax-h3": { inputMode: "multimodal", resolution: "768p", ratio: "16:9", duration: 15 },
          "minimax-h3-max": { inputMode: "first_last_frame", resolution: "768p", ratio: "adaptive", duration: 10 },
        },
      },
    });
    expect(restoreCanvasVideoModelPreference(videoTask(), "minimax-h3", getVideoModelSpec("minimax-h3"), preferences)).toMatchObject({
      model: "minimax-h3",
      inputMode: "multimodal",
      resolution: "768p",
      ratio: "16:9",
      duration: 15,
    });
  });

  it("carries current video parameters to another model when supported", () => {
    const current = videoTask({ model: "minimax-h3", inputMode: "text_to_video", resolution: "768p", ratio: "16:9", duration: 10 });

    expect(normalizeCanvasVideoTaskForModel(current, "minimax-h3-max", getVideoModelSpec("minimax-h3-max"))).toMatchObject({
      model: "minimax-h3-max", inputMode: "text_to_video", resolution: "768p", ratio: "16:9", duration: 10,
    });
  });

  it("normalizes stale video parameters to the selected model capabilities", () => {
    const staleMax = videoTask({
      model: "minimax-h3-max",
      inputMode: "multimodal",
      resolution: "720p",
      ratio: "16:9",
      duration: 4,
      generateAudio: true,
    });

    const normalized = normalizeCanvasVideoTaskForModel(staleMax, "minimax-h3-max", getVideoModelSpec("minimax-h3-max"));

    expect(normalized).toMatchObject({
      model: "minimax-h3-max",
      inputMode: "first_frame",
      resolution: "480p",
      ratio: "adaptive",
      duration: 5,
      generateAudio: false,
    });
    expect(normalized.omniReferenceTaskType).toBeUndefined();
    expect(normalized.outputFormat).toBeUndefined();
  });

  it("clears a previous model's custom image size when the target model has none remembered", () => {
    const current = imageTask({ model: "image 2", aspectRatio: "custom", customSize: "1600x900" });

    expect(restoreCanvasImageModelPreference(
      current,
      "nano-banana-pro",
      getCanvasImageModelParams("nano-banana-pro"),
      {},
    ).task.settings.customSize).toBeUndefined();
  });

  it("writes preferences only from the accepted generation paths", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    const updateData = board.slice(board.indexOf("const updateData"), board.indexOf("const rememberTaskPreferences"));
    const imageSubmit = board.slice(board.indexOf("const runImageOutput"), board.indexOf("const runVideoNode"));
    const videoSubmit = board.slice(board.indexOf("const runVideoNode"), board.indexOf("const resolveLlmVisualReferences"));

    expect(updateData).not.toContain("rememberCanvasTaskPreferences");
    expect(imageSubmit).toContain("rememberTaskPreferences");
    expect(videoSubmit).toContain("rememberTaskPreferences");
  });

  it("remembers image settings without copying prompt or task state", () => {
    const after = imageTask({ model: "nano-banana-pro", prompt: "不会记住", aspectRatio: "9:16", resolution: "4K", quality: "high", count: 3 });

    const preferences = rememberCanvasTaskPreferences({}, after);
    const next = applyCanvasTaskPreferences(imageTask(), preferences);

    expect(next).toMatchObject({
      kind: "imageTask",
      task: {
        references: [],
        settings: { model: "nano-banana-pro", prompt: "", aspectRatio: "9:16", resolution: "4K", quality: "high", count: 3 },
        batches: [],
      },
    });
  });

  it("remembers video parameters without copying prompt, media, output, or status", () => {
    const after = videoTask({
      model: "seedance-1.5-pro",
      prompt: "不会记住",
      mediaPaths: ["/private/input.png"],
      inputMode: "first_last_frame",
      resolution: "1080p",
      ratio: "16:9",
      duration: 10,
      cameraFixed: true,
      watermark: true,
      generateAudio: true,
      status: "success",
      outputUrl: "/private/output.mp4",
    });

    const preferences = rememberCanvasTaskPreferences({}, after);
    const next = applyCanvasTaskPreferences(videoTask(), preferences);

    expect(next).toEqual(videoTask({
      model: "seedance-1.5-pro",
      inputMode: "first_last_frame",
      resolution: "1080p",
      ratio: "16:9",
      duration: 10,
      generateAudio: true,
    }));
    expect(preferences.video).not.toHaveProperty("cameraFixed");
    expect(preferences.video).not.toHaveProperty("watermark");
  });

  it("isolates persisted preferences by user and ignores malformed storage", () => {
    const storage = memoryStorage();
    const preferences = rememberCanvasTaskPreferences({}, videoTask({ model: "kling-v2", duration: 8 }));

    writeCanvasTaskPreferences(storage, 7, preferences);
    storage.setItem("canvas_task_preferences_v1_9", "not-json");

    expect(readCanvasTaskPreferences(storage, 7)).toEqual(preferences);
    expect(readCanvasTaskPreferences(storage, 8)).toEqual({});
    expect(readCanvasTaskPreferences(storage, 9)).toEqual({});
  });

  it("migrates the previous single-model storage shape", () => {
    const storage = memoryStorage();
    storage.setItem("canvas_task_preferences_v1_12", JSON.stringify({
      image: { model: "nano-banana-pro", aspectRatio: "16:9", resolution: "4K", count: 2 },
      video: { model: "minimax-h3", inputMode: "multimodal", resolution: "768p", ratio: "16:9", duration: 15 },
    }));

    expect(readCanvasTaskPreferences(storage, 12)).toMatchObject({
      image: {
        lastModel: "nano-banana-pro",
        byModel: { "nano-banana-pro": { aspectRatio: "16:9", resolution: "4K", count: 2 } },
      },
      video: {
        lastModel: "minimax-h3",
        byModel: { "minimax-h3": { inputMode: "multimodal", resolution: "768p", ratio: "16:9", duration: 15 } },
      },
    });
  });
});


it.each(["512x288", "288x512", "640x432"])("round-trips %s GIF settings and clears animation format on a static model", gifSize => {
  const model = "gpt-image-2.6-apimart";
  const settings = { model, outputFormat: "gif", gifSize, frameCount: 8, frameDurationMs: 120 };
  const task = imageTask(settings);
  const storage = memoryStorage();
  writeCanvasTaskPreferences(storage, 7, rememberCanvasTaskPreferences({}, task));
  const restored = restoreCanvasImageModelPreference(imageTask(), model, getCanvasImageModelParams(model), readCanvasTaskPreferences(storage, 7));
  expect(restored.task.settings).toMatchObject(settings);
  const staticTask = carryCanvasImageTaskSettingsToModel(task, "gpt-image-2.5-apimart", getCanvasImageModelParams("gpt-image-2.5-apimart"));
  expect(staticTask.task.settings.outputFormat).toBe("png");
  expect(staticTask.task.settings.frameCount).toBeUndefined();
});
