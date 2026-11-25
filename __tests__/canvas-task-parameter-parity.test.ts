import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const nodeCard = read("components/canvas/CanvasNodeCard.tsx");
const parameterPopover = read("components/canvas/CanvasTaskParameterPopover.tsx");
const smartCanvasBoard = read("components/canvas/SmartCanvasBoard.tsx");
const frostedSelect = read("components/ui/frosted-select.tsx");
const taskPopoverEvents = read("lib/canvas/task-popover-events.ts");
const generatorShell = read("components/canvas/CanvasGeneratorShell.tsx");
const styles = read("app/globals.css");
const theme = read("styles/theme-system.css");

const imagePanel = nodeCard.slice(
  nodeCard.indexOf("function ImageTaskPanel"),
  nodeCard.indexOf("function VideoTaskPanel"),
);
const videoPanel = nodeCard.slice(
  nodeCard.indexOf("function VideoTaskPanel"),
  nodeCard.indexOf("function LlmTaskPanel"),
);
const llmPanel = nodeCard.slice(
  nodeCard.indexOf("function LlmTaskPanel"),
  nodeCard.indexOf("function ViewportFixedTaskPanel"),
);

describe("canvas task parameters", () => {
  it("uses Canvas semantic surfaces instead of the black #101113 parameter island", () => {
    expect(styles).toContain("--canvas-task-param-bg: var(--canvas-controls-bg);");
    expect(styles).toContain("--canvas-task-param-border: var(--canvas-controls-border);");
    expect(styles).toContain("--canvas-task-param-divider: var(--canvas-controls-active);");
    expect(styles).toContain("--canvas-task-param-active: var(--canvas-controls-hover);");
    expect(styles).not.toContain("--canvas-task-param-bg: #101113");
    expect(theme).toContain("--canvas-task-param-border: var(--canvas-controls-border);");
    expect(theme).toContain("--canvas-task-param-divider: var(--canvas-controls-active);");
  });

  it("keeps project model data while showing only the 13px model name", () => {
    expect(imagePanel).toContain("availableImageModels.map");
    expect(videoPanel).toContain("(models?.video || []).map");
    expect(imagePanel).not.toContain('className="canvas-task-model-id"');
    expect(videoPanel).not.toContain("hint: item.id");
    expect(llmPanel).not.toContain("hint: models?.canvasDefault.modelId");
    expect(llmPanel).not.toContain("hint: model.modelId");
    expect(llmPanel).toContain("label: model.label || model.modelId");
    expect(imagePanel).toContain("canvas-task-parameter-bar");
    expect(imagePanel).toContain("canvas-task-parameter-trigger");
    expect(videoPanel).toContain("canvas-task-parameter-bar");
    expect(styles).toMatch(/\.canvas-task-parameter-trigger\s*\{[\s\S]*?height:\s*32px;[\s\S]*?font-size:\s*13px;/);
    expect(styles).toMatch(/\.canvas-task-model-option\s*\{[\s\S]*?min-height:\s*52px;/);
    expect(styles).toMatch(/\.canvas-task-model-label\s*\{[\s\S]*?font-size:\s*13px;/);
    expect(styles).not.toContain(".canvas-task-model-id");
    expect(imagePanel).toContain("<TaskSubmitButton");
    expect(videoPanel).toContain("<TaskSubmitButton");
    expect(styles).toMatch(/\.canvas-task-submit-button\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?border-radius:\s*12px;/);
  });

  it("renders video ratios, resolution and duration in one parameter popover", () => {
    expect(videoPanel).toContain("videoParameterSummary");
    expect(videoPanel).toContain("data-canvas-video-parameter-trigger");
    expect(videoPanel).toContain("data-canvas-video-parameter-popover");
    expect(videoPanel).toContain("canvas-video-parameter-ratio-grid");
    expect(videoPanel).toContain("<CanvasAspectRatioIcon");
    expect(videoPanel).toContain('type="range"');
    expect(videoPanel).toContain('aria-label="视频时长"');
    expect(styles).toMatch(/\.canvas-video-advanced-popover\s*\{[\s\S]*?width:\s*344px;/);
    expect(styles).toMatch(/\.canvas-video-advanced-popover \.canvas-task-parameter-sections\s*\{[\s\S]*?gap:\s*12px;/);
    expect(styles).toMatch(/\.canvas-task-parameter-option\[data-selected="true"\]/);
  });

  it("uses the same fixed menu typography and geometry for video and text", () => {
    expect(videoPanel).toMatch(/ariaLabel="视频模型"[\s\S]*?menuWidth=\{304\}[\s\S]*?menuMaxHeight=\{400\}[\s\S]*?optionHeight=\{52\}/);
    expect(llmPanel).toMatch(/ariaLabel="LLM 模型"[\s\S]*?menuWidth=\{360\}[\s\S]*?menuMaxHeight=\{400\}[\s\S]*?optionHeight=\{52\}/);
    expect(videoPanel).toContain('aria-label="视频生成模式"');
    expect(videoPanel).not.toContain('ariaLabel="输入模式"');
    expect(frostedSelect).toContain("leading-[18px]");
    expect(styles).toMatch(/\.canvas-task-model-popover \[role="option"\] > \.flex\s*\{[\s\S]*?line-height:\s*18px;/);
    expect(styles).not.toContain('.canvas-task-model-popover [role="option"] > .flex > span:last-child');
  });

  it("restores each model's own remembered task parameters", () => {
    const imageChangeModel = imagePanel.slice(
      imagePanel.indexOf("const changeModel"),
      imagePanel.indexOf("const imageModelOptions"),
    );
    const videoChangeModel = videoPanel.slice(
      videoPanel.indexOf("const changeModel"),
      videoPanel.indexOf("const videoModelSelect"),
    );

    expect(imageChangeModel).toContain("editor?.changeTaskModel(id, model);");
    expect(videoChangeModel).toContain("editor?.changeTaskModel(id, nextModel);");
    expect(videoPanel).not.toContain("!spec.supportedInputModes.some");
  });

  it("replaces an admin-disabled model with the first enabled model", () => {
    expect(imagePanel).toContain("resolveCanvasModelId(availableImageModels, settings.model)");
    expect(videoPanel).toContain("resolveCanvasModelId(models?.video || [], data.model)");
    expect(llmPanel).toContain("fallbackLlmModel");
    expect(llmPanel).toContain("selectedLlmModel || fallbackLlmModel");
    expect(smartCanvasBoard).toContain('if (models?.capabilityStatus !== "loaded") return;');
    expect(smartCanvasBoard).toContain("for (const node of documentRef.current.nodes)");
    expect(smartCanvasBoard).toContain("resolveCanvasModelId(imageModels, current.task.settings.model)");
    expect(smartCanvasBoard).toContain("resolveCanvasModelId(models.video, current.model)");
    expect(smartCanvasBoard).toContain('}, "replace");');
    expect(smartCanvasBoard).toContain("model: runnableImageModel");
    expect(smartCanvasBoard).toContain("model: runnableVideoModel");
    expect(smartCanvasBoard).toContain("override: requestedLlmModel");
    expect(nodeCard).not.toContain("模型已停用");
  });

  it("anchors every task parameter popover to the trigger that opened it", () => {
    expect(imagePanel).toContain("imageModelTriggerRef");
    expect(imagePanel).toContain("imageParamsTriggerRef");
    expect(imagePanel).not.toContain("imageCountTriggerRef");
    expect(imagePanel).toContain("parameterAnchorRef");
    expect(imagePanel).toContain("anchorRef={parameterAnchorRef}");
    expect(imagePanel).toContain('align="start"');
    expect(videoPanel).toMatch(/anchorRef=\{advancedTriggerRef\}[\s\S]*?align="start"/);
    expect(llmPanel).toMatch(/anchorRef=\{systemTriggerRef\}[\s\S]*?align="start"/);
  });

  it("keeps image count inside the shared parameter popover with only 1, 2 and 4", () => {
    expect(nodeCard).toContain("const CANVAS_IMAGE_COUNT_OPTIONS = [1, 2, 4] as const;");
    expect(imagePanel).toContain("imageCountOptions.map");
    expect(imagePanel).toContain(">生成数量</div>");
    expect(imagePanel).toContain('`${displayedImageCount} 张`');
    expect(imagePanel).not.toContain('parameterPanelOpen === "count"');
    expect(imagePanel).not.toContain('data-parameter-panel="count"');
  });

  it("renders Midjourney V8.2 as adaptive resolution with one full-width fixed four-image option", () => {
    expect(imagePanel).toContain("isMidjourneyV8Model(imageModel)");
    expect(imagePanel).toContain("fixedImageCount");
    expect(imagePanel).toContain("displayedImageCount");
    expect(imagePanel).toContain("imageCountOptions");
    expect(imagePanel).toContain("resolutionLabel");
    expect(imagePanel).toContain("gridTemplateColumns: `repeat(${imageCountOptions.length}, minmax(0, 1fr))`");
    expect(imagePanel).toContain("aria-disabled={Boolean(fixedImageCount)}");
    expect(smartCanvasBoard).toContain("getCanvasImageRequestCount");
    expect(smartCanvasBoard).toContain("getCanvasImageSubmissionResolution");
  });

  it("opens every generator footer menu above its own trigger", () => {
    expect(parameterPopover).toContain('side?: "top" | "bottom" | "auto";');
    expect(imagePanel).toMatch(/<CanvasTaskParameterPopover[\s\S]*?side="top"/);
    expect(videoPanel).toMatch(/const videoModelSelect = \([\s\S]*?side="top"/);
    expect(videoPanel).toMatch(/anchorRef=\{advancedTriggerRef\}[\s\S]*?side="top"/);
    expect(llmPanel).toMatch(/ariaLabel="LLM 模型"[\s\S]*?side="top"/);
    expect(llmPanel).toMatch(/anchorRef=\{systemTriggerRef\}[\s\S]*?side="top"/);
  });

  it("closes Canvas parameter portals when the viewport starts moving, while leaving menu scrolling alone", () => {
    const viewportMoveStart = smartCanvasBoard.slice(
      smartCanvasBoard.indexOf("const handleMoveStart"),
      smartCanvasBoard.indexOf("const handleMoveEnd"),
    );

    expect(taskPopoverEvents).toContain("CANVAS_TASK_POPOVER_DISMISS_EVENT");
    expect(taskPopoverEvents).toContain("dismissCanvasTaskPopovers");
    expect(taskPopoverEvents).toContain("window.dispatchEvent");
    expect(viewportMoveStart).toContain("dismissCanvasTaskPopovers()");
    expect(parameterPopover).toContain(
      'window.addEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT',
    );
    expect(parameterPopover).toContain(
      'window.removeEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT',
    );
    expect(frostedSelect).toContain(
      'if (variant === "canvas") window.addEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT',
    );
    expect(frostedSelect).toContain(
      'if (variant === "canvas") window.removeEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT',
    );
    expect(parameterPopover).not.toContain('document.addEventListener("wheel"');
    expect(frostedSelect).not.toContain('document.addEventListener("wheel"');
  });

  it("portals parameter menus and hover previews above the expanded dialog", () => {
    expect(nodeCard).toContain("CanvasTaskParameterPopover");
    expect(nodeCard).toContain("canvas-task-asset-hover-preview");
    expect(styles).toContain("--canvas-layer-dialog: 1001;");
    expect(styles).toContain("--canvas-layer-hover-preview: 1040;");
    expect(styles).toContain("--canvas-layer-popover: 1050;");
    expect(styles).toMatch(/\.canvas-task-asset-hover-preview\s*\{[\s\S]*?z-index:\s*var\(--canvas-layer-hover-preview\);/);
    expect(frostedSelect).toContain('variant === "canvas" ? "var(--canvas-layer-popover)" : 200');
    expect(generatorShell).toContain('data-canvas-generator-dialog className="fixed inset-0 z-[1000]');
  });

  it("does not leave invisible reference actions clickable", () => {
    expect(styles).toMatch(/\[data-canvas-reference-remove\][\s\S]*?pointer-events:\s*none;/);
    expect(styles).toMatch(/\.canvas-reference-card:hover \[data-canvas-reference-remove\][\s\S]*?pointer-events:\s*auto;/);
  });
});
