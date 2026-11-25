import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const nodeCard = read("components/canvas/CanvasNodeCard.tsx");
const frostedSelect = read("components/ui/frosted-select.tsx");
const styles = read("app/globals.css");

describe("canvas task parameter surfaces", () => {
  it("uses the sampled neutral canvas surface and one unified video parameter popover", () => {
    const imagePanel = nodeCard.slice(nodeCard.indexOf("function ImageTaskPanel"), nodeCard.indexOf("function VideoTaskPanel"));
    const videoPanel = nodeCard.slice(nodeCard.indexOf("function VideoTaskPanel"), nodeCard.indexOf("function LlmTaskPanel"));

    expect(styles).toContain("--canvas-task-param-bg: var(--canvas-controls-bg);");
    expect(styles).toContain("--canvas-task-param-active: var(--canvas-controls-hover);");
    expect(styles).not.toContain("--canvas-task-param-bg: #101113;");
    expect(styles).toContain(".canvas-task-parameter-popover");
    expect(styles).not.toContain(".canvas-task-video-parameter-control > button");
    expect(imagePanel).toContain("CanvasTaskParameterPopover");
    expect(videoPanel).not.toContain('className="canvas-task-video-parameter-control"');
    expect(videoPanel).toContain("videoParameterSummary");
    expect(videoPanel).toContain("data-canvas-video-parameter-trigger");
    expect(videoPanel).toContain("data-canvas-video-parameter-popover");
    expect(videoPanel).toContain("canvas-video-task-footer");
    expect(videoPanel).toContain("canvas-video-advanced-popover");
    expect(videoPanel).not.toContain('className="grid grid-cols-[minmax(140px,1.6fr)_repeat(4,minmax(0,1fr))] gap-1"');
    expect(frostedSelect).toContain("menuClassName?: string;");
    expect(frostedSelect).toContain("menuClassName = \"\"");
    expect(frostedSelect).toContain("menuClassName\n          ].join");
  });

  it("matches the shared parameter bar, portal and submit rhythm in the LLM footer", () => {
    const llmPanel = nodeCard.slice(nodeCard.indexOf("function LlmTaskPanel"), nodeCard.indexOf("function ViewportFixedTaskPanel"));

    expect(llmPanel).toContain("models?.canvasDefault.modelId");
    expect(llmPanel).toContain("model.providerId");
    expect(llmPanel).toContain('ariaLabel="LLM 模型"');
    expect(llmPanel).toContain("canvas-task-parameter-bar");
    expect(llmPanel).toContain('buttonClassName="canvas-task-model-trigger !h-8 min-w-[88px] max-w-[240px]"');
    expect(llmPanel).toContain('menuClassName="canvas-task-parameter-popover canvas-task-model-popover"');
    expect(llmPanel).toContain("data-canvas-llm-system-settings");
    expect(llmPanel).toContain("CanvasTaskParameterPopover");
    expect(llmPanel).toContain("data.system");
    expect(llmPanel).toContain("<TaskSubmitButton");
    expect(llmPanel).toContain('label="运行文本"');
  });
});
