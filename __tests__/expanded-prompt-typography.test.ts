import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("expanded prompt typography", () => {
  it("uses 16px type with a larger line height only when the rich editor is expanded", () => {
    const editor = source("components/ui/prompt-rich-editor.tsx");

    expect(editor).toContain("expanded?: boolean;");
    expect(editor).toContain('expanded ? "text-base leading-7" : "text-sm leading-relaxed"');
  });

  it("enables expanded typography for image, video, and canvas prompt panels", () => {
    const imageTool = source("app/image/image-tool.tsx");
    const videoTool = source("app/video/video-tool.tsx");
    const canvasNode = source("components/canvas/CanvasNodeCard.tsx");

    expect(imageTool).toContain("expanded={expanded}");
    expect(imageTool).toContain('renderPromptEditor(promptPanelOpen ? "h-full resize-none" : "w-full h-full resize-none", promptPanelOpen)');
    expect(imageTool).toContain('contentClassName={expanded ? "pr-3 pb-12" : "pr-5 pb-12"}');
    expect(videoTool).toContain("expanded={expanded}");
    expect(videoTool).toContain('renderPromptEditor(promptPanelOpen ? "h-full resize-none" : "w-full h-full resize-none", promptPanelOpen)');
    expect(videoTool).toContain('contentClassName={expanded ? "pr-3 pb-12" : "pr-5 pb-12"}');
    expect(canvasNode).toContain("expanded={expanded}");
  });

  it("keeps the batch prompt compact until its panel is expanded", () => {
    const editor = source("components/ui/expandable-prompt-textarea.tsx");

    expect(editor).toContain("<PromptRichEditor");
    expect(editor).toContain("expanded={expanded}");
    expect(editor).toContain('expanded ? "" : "!text-xs !leading-5"');
    expect(editor).toContain('<PromptEditorPortal target={editorHost}>{renderEditor(open)}</PromptEditorPortal>');
  });
});
