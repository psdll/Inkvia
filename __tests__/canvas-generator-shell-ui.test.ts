import { verifyTaskWorkspace, verifyTextWritingEntry, verifyConnectedTextReference } from './helpers/canvas-ui-contract-harness';

import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const shell = read("components/canvas/CanvasGeneratorShell.tsx");
const node = read("components/canvas/CanvasNodeCard.tsx");
const board = read("components/canvas/SmartCanvasBoard.tsx");
const frostedSelect = read("components/ui/frosted-select.tsx");
const documentSource = read("lib/canvas/document.ts");
const imageTask = read("lib/canvas/image-task.ts");
const styles = read("app/globals.css");

describe("shared canvas generator shell", () => {
  it("displays connected text and updates, locates and removes its reference", verifyConnectedTextReference);

  it("shows the text node start layout with only the first workflow enabled", verifyTextWritingEntry);

  it("uses one 660px inverse-scale shell for image and video panels", () => {
    expect(shell).toContain("CANVAS_GENERATOR_COLLAPSED_WIDTH = 660");
    expect(node.match(/<CanvasGeneratorShell/g)?.length).toBeGreaterThanOrEqual(2);
    expect(node).toContain("CANVAS_GENERATOR_COMPACT_MIN_WIDTH");
    expect(styles).toContain("border: 0.5px solid var(--canvas-controls-border)");
    expect(styles).toContain("border-radius: 16px");
    expect(styles).toContain("padding: 8px");
    expect(styles).toContain("gap: 8px");
  });

  it("expands the existing panel in place without a modal or resize overlay", () => {
    expect(shell).toContain('role="region"');
    expect(shell).toContain("canvas-generator-shell--expanded");
    expect(shell).not.toContain("<Portal>");
    expect(shell).not.toContain("setPointerCapture");
    expect(styles).toContain("height: min(516px, calc(100dvh - 104px))");
  });
  it("renders the ordered 48px reference strip with remove, mention, locate and drag affordances", () => {
    expect(node).toContain("reorderTaskReferences:");
    expect(node).toContain("removeTaskReference:");
    expect(node).toContain("locateCanvasNode:");
    expect(node).toContain("mentionTaskReference:");
    expect(node).toContain("data-canvas-reference-sequence");
    expect(node).toContain("data-canvas-reference-remove");
    expect(node).toContain("data-canvas-reference-mention");
    expect(node).toContain("onDoubleClick");
    expect(styles).toContain("width: 48px");
    expect(styles).toContain("height: 48px");
    expect(styles).toContain("height: 14px");
    expect(styles).toContain("width: 15px");
    expect(styles).toContain("width: 12px");
  });

  it("routes image, video and LLM through the same task workspace and generator shell", async () => {

    for (const [kind, placeholder] of [["imageTask", "image"], ["videoTask", "video"], ["llm", "text"]]) await verifyTaskWorkspace(kind, placeholder);
  });

  it("uses neutral empty-result surfaces and filled media-specific glyphs", async () => {

    for (const [kind, placeholder] of [["imageTask", "image"], ["videoTask", "video"], ["audioTask", "audio"], ["llm", "text"]]) await verifyTaskWorkspace(kind, placeholder);
  });

  it("removes the no-op reference action and keeps the shared 32px Canvas select variant", () => {
    expect(node).not.toContain("openAssetLibrary:");
    expect(node).toContain("canvas-generator-preset-button");
    expect(node).not.toContain("+参考");
    expect(node).not.toContain("+引用");
    expect(node).toContain("预设提示词");
    expect(node).not.toContain("角色库");
    expect(node).not.toContain("运镜库");
    expect(frostedSelect).toContain('export type FrostedSelectVariant = "default" | "toolbar" | "canvas"');
    expect(frostedSelect).toContain('variant === "canvas"');
    expect(styles).toMatch(/\.canvas-generator-actions\s*\{[\s\S]*?gap:\s*2px;/);
  });
});
