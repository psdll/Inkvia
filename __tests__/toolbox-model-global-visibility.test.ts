import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { IMAGE_EDIT_MODEL_DEFINITIONS, TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("global toolbox model visibility", () => {
  it("uses provider shorthand display labels in both toolbox model registries", () => {
    const expectedLabels = {
      "nano-banana-pro": "nano-banana-pro（ke）",
      "gpt-image-2": "GPT-Image-2（ke）",
      "gpt-image-2-apimart": "GPT-Image-2（am）",
      "gemini-3.1-flash-image": "nano-banana-2",
      "gemini-3.1-flash-lite-image": "nano-banana-2-lite",
      "gemini-3-pro-image": "nano-banana-pro",
    };

    for (const [id, label] of Object.entries(expectedLabels)) {
      expect(IMAGE_EDIT_MODEL_DEFINITIONS.find((model) => model.id === id)?.label).toBe(label);
      expect(TOOLBOX_MODEL_DEFINITIONS.find((model) => model.id === id)?.label).toBe(label);
    }
  });

  it("keeps the image, video, and face tools fail-closed until the admin-filtered list loads", () => {
    expect(source("app/image/image-tool.tsx")).toContain(
      "React.useState<FrostedSelectOption[]>([])",
    );
    expect(source("app/video/video-tool.tsx")).toContain(
      "React.useState<ReturnType<typeof getVideoDisplaySpec>[]>([])",
    );

  });

  it("uses the admin-filtered surface model lists for canvas and Live batches", () => {
    const canvasRoute = source("app/api/canvas/models/route.ts");
    const liveRoute = source("app/api/live-video-batches/models/route.ts");
    const canvasClient = source("components/canvas/use-canvas-models.ts");

    expect(canvasRoute).toContain("getVisibleImageEditModels()");
    expect(canvasRoute).toContain('getVisibleToolboxModels("video")');
    expect(canvasClient).toContain("image: []");
    expect(canvasClient).toContain("video: []");
    expect(liveRoute).toContain('getVisibleToolboxModels("video")');
    expect(liveRoute).toContain("visibleModel.supportedResolutions");
  });

  it("enforces the same model and resolution visibility during generation", () => {
    const videoService = source("lib/generation/video-service.ts");
    const imageBatch = source("components/batch-workbench/batch-workbench-page.tsx");

    expect(videoService).toContain("isVideoModelVisible(model, cleanString(input.resolution), input.duration)");
    expect(imageBatch).toContain("models.some((model) => model.id === requestedModel)");
    expect(imageBatch).toContain('model: models[0]?.id || ""');
  });

  it("keeps admin template selectors and canvas nodes on the filtered lists", () => {
    const templates = source("components/admin/InspirationTemplatesPanel.tsx");
    const canvas = source("components/canvas/CanvasNodeCard.tsx");

    expect(templates).toContain('["image", "video"] as const');
    expect(templates).toContain("toolboxModelOptions[toolType]");
    expect(canvas).toContain("resolveCanvasModelId");
    expect(canvas).not.toContain("当前模型已停用，请重新选择管理员启用的模型");
  });

  it("refreshes Canvas models across tabs when an administrator changes LLM availability", () => {
    const providers = source("components/admin/ProvidersPanel.tsx");
    const events = source("lib/toolbox-model-visibility-events.ts");

    expect(providers).toContain("publishToolboxModelVisibilityChanged()");
    expect(providers).toContain('window.dispatchEvent(new Event("llm-routes-changed"))');
    expect(events).toContain("BroadcastChannel");
  });
});
