import { verifyMaterialToolbar, verifyInlineAudio } from './helpers/canvas-ui-contract-harness';
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const node = read("components/canvas/CanvasNodeCard.tsx");
const textNode = read("components/canvas/CanvasTextNode.tsx");
const board = read("components/canvas/SmartCanvasBoard.tsx");
const styles = read("app/globals.css");

describe("canvas material nodes", () => {
  it("uses the 24px metadata row with 14px icon and 13px type", () => {
    expect(node).toContain("function CanvasMaterialMetadata(");
    expect(node).toContain("<CanvasNodeHeading");
    expect(read("components/canvas/CanvasNodeHeading.tsx")).toContain("Math.min(2, 1 / state.transform[2])");
    expect(node).toContain("canvas-material-metadata");
    expect(styles).toContain("height: 24px");
    expect(styles).toContain("font-size: 13px");
    expect(styles).toContain("width: 14px");
    expect(styles).toContain("color: var(--canvas-controls-text-muted)");
  });

  it("uses one neutral 12px material frame for uploaded and generated media", () => {
    expect(node.match(/canvas-material-frame/g)?.length).toBeGreaterThanOrEqual(2);
    expect(node).toContain("canvas-material-frame-selected");
    expect(styles).toContain("border-radius: 12px");
    expect(styles).toContain("border: 1px solid var(--canvas-node-border)");
    expect(styles).toContain("border-color: var(--canvas-node-border-selected)");
    expect(node.match(/object-cover/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("shares one non-wrapping half-pixel toolbar shell and 40px actions", () => {
    expect(node).toContain("function CanvasMaterialToolbar(");
    expect(node.match(/<CanvasMaterialToolbar>/g)?.length).toBeGreaterThanOrEqual(5);
    expect(node).toContain("canvas-material-toolbar-item");
    expect(node).toContain("CanvasMaterialToolbarSeparator");
    expect(styles).toContain("border: 0.5px solid var(--canvas-controls-border)");
    expect(styles).toContain("backdrop-filter: blur(16px)");
    expect(styles).toContain("height: 40px");
    expect(styles).toContain("width: 0.5px");
  });

  it("places every material preview as the icon-only final toolbar action", async () => {

    for (const kind of ["image", "video", "imageTask", "videoTask"]) await verifyMaterialToolbar(kind); for (const kind of ["audio", "audioTask"]) await verifyInlineAudio(kind);
  });

  it("uses Canvas handle tokens and the approved target transition timing", () => {
    const handle = readFileSync("components/canvas/CanvasConnectionHandle.tsx", "utf8");
    expect(handle).toContain("var(--canvas-handle-bg)");
    expect(handle).toContain("var(--canvas-handle-icon)");
    expect(styles).toContain("transition: opacity 400ms ease-out, transform 400ms ease-out");
    expect(styles).toContain("transition: opacity 400ms ease-out");
    expect(styles).toContain("transition-duration: 80ms");
    expect(styles).toContain("transition-timing-function: ease-out");
  });

  it("uses the exact neutral embedded-video control geometry", () => {
    expect(node).toContain("canvas-video-controls");
    expect(node).toContain("canvas-video-control-row");
    expect(node).toContain("canvas-video-play-button");
    expect(node).toContain("canvas-video-progress");
    expect(node).toContain("canvas-video-time");
    expect(node).toContain("canvas-video-volume-button");
    expect(node).toContain("canvas-video-volume-slider");
    expect(read("components/canvas/CanvasVideoFrameControls.tsx")).toContain("canvas-video-frame-button");
    expect(styles).toContain("height: 80px");
    expect(styles).toContain("bottom: 10px");
    expect(styles).toContain("height: 28px");
    expect(styles).toContain("font-size: 12px");
    expect(styles).toContain("height: 14px");
    expect(styles).toContain("background-size: 100% 3px");
    expect(styles).toContain("width: 10px");
    expect(styles).toContain("width: 80px");
  });

  it("routes prompt materials through a 350 by 200 editable text node", () => {
    expect(node).toContain("<CanvasTextNode");
    expect(board).toContain('kind === "prompt" || kind === "llm" ? 350');
    expect(board).toContain('kind === "prompt" || kind === "llm" ? 200');
    expect(textNode).toContain("DEFAULT_CANVAS_TEXT_NODE_SIZE = { width: 350, height: 200 }");
    expect(textNode).toContain("MIN_CANVAS_TEXT_NODE_SIZE = { width: 200, height: 100 }");
    expect(textNode).toContain("onDoubleClick={beginEditing}");
    expect(textNode).toContain("textarea.select()");
    expect(textNode).toContain('document.addEventListener("pointerdown", handleOutsidePointerDown)');
    expect(textNode).toContain('className="canvas-text-node-editor nodrag nowheel"');
  });

  it("hands boundary wheel events back to the canvas and resizes in world units", () => {
    expect(textNode).toContain("scrollTop > 0");
    expect(textNode).toContain("scrollTop + clientHeight < scrollHeight");
    expect(textNode).toContain('classList.remove("nowheel")');
    expect(textNode).toContain("event.clientX - start.clientX) / zoom");
    expect(textNode).toContain("event.clientY - start.clientY) / zoom");
    expect(styles).toContain("padding: 12px 16px");
    expect(styles).toContain("width: 16px");
    expect(styles).toContain("height: 16px");
    expect(styles).toContain("backdrop-filter: blur(1.5px)");
  });
});
