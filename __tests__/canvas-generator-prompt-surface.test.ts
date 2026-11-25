import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const node = read("components/canvas/CanvasNodeCard.tsx");
const editor = read("components/ui/prompt-rich-editor.tsx");
const shell = read("components/canvas/CanvasGeneratorShell.tsx");
const css = read("app/globals.css");

describe("canvas generator prompt surface", () => {
  it("uses one transparent generator variant for image, video, and LLM prompts", () => {
    expect(editor).toContain('variant?: "default" | "canvasGenerator"');
    expect(editor).toContain('variant === "canvasGenerator"');
    expect(node.match(/variant="canvasGenerator"/g)).toHaveLength(4);
    expect(css).toContain(".canvas-generator-prompt-surface");
    expect(css).toContain("min-height: 80px");
    expect(css).toContain("max-height: 100px");
    expect(css).toContain("background: transparent");
  });

  it("keeps wheel events inside every canvas generator prompt viewport", () => {
    expect(node.match(/variant="canvasGenerator"/g)).toHaveLength(4);
    expect(editor).toMatch(
      /variant === "canvasGenerator"[\s\S]*?\? "canvas-generator-prompt-viewport nowheel\b/,
    );
  });

  it("makes the expanded prompt fill the remaining generator height", () => {
    expect(node.match(/canvas-generator-prompt-surface--expanded/g)).toHaveLength(4);
    expect(css).toContain(".canvas-generator-prompt-surface--expanded");
    expect(css).toContain("flex: 1 1 0%");
    expect(css).toContain("height: 100%");
  });

  it("keeps the overflow wheel fallback without a dismissing backdrop", () => {
    expect(shell).toContain("onWheel={stopCanvasEvent}");
    expect(editor).toContain("scrollHeight > event.currentTarget.clientHeight + 1");
    expect(shell).not.toContain("data-canvas-generator-backdrop");
    expect(shell).toContain("onClick={() => setExpanded(!expanded)}");
    expect(shell).toContain("data-canvas-generator-resize");
  });

  it("does not generate during IME composition and consumes Escape in open suggestion menus first", () => {
    expect(node.match(/event\.nativeEvent\.isComposing/g)?.length).toBeGreaterThanOrEqual(3);
    expect(editor).toContain("exitSuggestion(editor.view, assetMentionSuggestionPluginKey)");
    expect(editor).toContain("event.stopPropagation()");
  });

  it("keeps the expand control interactive above a pointer-transparent task shell", () => {
    expect(css).toMatch(/\.canvas-generator-expand-button\s*\{[\s\S]*?pointer-events:\s*auto/);
  });

  it("expands in place while keeping the shell in the node layout", () => {
    expect(css).toContain(".canvas-generator-shell--expanded");
    expect(shell).not.toContain("<Portal>");
  });
});
