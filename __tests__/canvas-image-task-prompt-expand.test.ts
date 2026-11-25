import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const nodeCard = readFileSync(resolve(process.cwd(), "components/canvas/CanvasNodeCard.tsx"), "utf8");
const shell = readFileSync(resolve(process.cwd(), "components/canvas/CanvasGeneratorShell.tsx"), "utf8");
const promptEditor = readFileSync(resolve(process.cwd(), "components/ui/prompt-rich-editor.tsx"), "utf8");

describe("canvas image-task prompt expansion", () => {
  it("expands the image-task prompt editor into a persistent non-modal panel with shared state", () => {
    const imageTaskPanel = nodeCard.slice(nodeCard.indexOf("function ImageTaskPanel"), nodeCard.indexOf("function VideoTaskPanel"));

    expect(imageTaskPanel).toContain("<CanvasGeneratorShell");
    expect(shell).toContain('"展开编辑面板"');
    expect(shell).toContain('"收起编辑面板"');
    expect(shell).toContain('role="region"');
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain("data-canvas-generator-expanded");
    expect(shell).not.toContain("<Portal>");
    expect(imageTaskPanel).toContain("settings.prompt");
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain("aria-expanded={expanded}");
  });

  it("keeps the @ asset menu above the expanded prompt dialog", () => {
    const imageTaskPanel = nodeCard.slice(nodeCard.indexOf("function ImageTaskPanel"), nodeCard.indexOf("function VideoTaskPanel"));
    const assetMenuZIndex = Number(promptEditor.match(/component\.element\.style\.zIndex = "(\d+)"/)?.[1]);

    expect(shell).not.toContain("fixed left-1/2");
    expect(assetMenuZIndex).toBeGreaterThan(0);
  });

  it("pins template and generate actions to the right in both panel sizes", () => {
    const imageTaskPanel = nodeCard.slice(nodeCard.indexOf("function ImageTaskPanel"), nodeCard.indexOf("function VideoTaskPanel"));

    expect(imageTaskPanel).toContain('className="ml-auto flex shrink-0 items-center gap-2"');
    expect(imageTaskPanel).toContain("renderImageTaskPanel(expanded)");
  });
});
