import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentPath = "components/canvas/CanvasConnectionHandle.tsx";
const component = existsSync(componentPath) ? readFileSync(componentPath, "utf8") : "";
const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
const textNode = readFileSync("components/canvas/CanvasTextNode.tsx", "utf8");

describe("canvas connection handle motion", () => {
  it("uses mirrored idle offsets and clamps active pointer following inside the 80px hit area", async () => {
    const motion = await import("@/lib/canvas/connection-handle-motion").catch(() => ({}));
    const resolveMotion = (motion as any).getCanvasConnectionHandleMotion;
    const pointerOffset = (motion as any).getCanvasConnectionHandlePointerOffset;

    expect(resolveMotion).toBeTypeOf("function");
    expect(pointerOffset).toBeTypeOf("function");
    if (typeof resolveMotion !== "function" || typeof pointerOffset !== "function") return;

    expect(resolveMotion("source", null)).toEqual({ x: -25, y: 0, opacity: 0, scale: 1 });
    expect(resolveMotion("target", null)).toEqual({ x: 25, y: 0, opacity: 0, scale: 1 });
    expect(resolveMotion("source", { x: 0, y: 0 })).toEqual({ x: 0, y: 0, opacity: 1, scale: 1.1 });
    const diagonal = resolveMotion("target", { x: 80, y: -80 });
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(30);
    expect(diagonal.x).toBeCloseTo(-diagonal.y);

    expect(pointerOffset(
      { x: 20, y: 20 },
      { left: 0, top: 0, width: 40, height: 40 },
    )).toEqual({ x: 0, y: 0 });
    expect(pointerOffset(
      { x: 40, y: 0 },
      { left: 0, top: 0, width: 40, height: 40 },
    )).toEqual({ x: 20, y: -20 });
  });

  it("renders a zero-size edge root, 80px hit area, and exact 20px SVG", () => {
    expect(component).toContain("!h-0 !w-0");
    expect(component).toContain("CANVAS_CONNECTION_HANDLE_HIT_SIZE");
    expect(component).toContain("width: CANVAS_CONNECTION_HANDLE_HIT_SIZE");
    expect(component).toContain("height: CANVAS_CONNECTION_HANDLE_HIT_SIZE");
    expect(component).toContain('data-canvas-connection-handle-hit-area');
    expect(component).toContain('cursor: "crosshair"');
    expect(component).toContain('width="20" height="20" viewBox="0 0 20 20"');
    expect(component).toContain('<circle cx="10" cy="10" r="9.35"');
    expect(component).toContain('strokeWidth="1.2"');
    expect(component).toContain("plusSize = 7");
    expect(component).toContain("const plusStart = 10 - plusSize / 2");
    expect(component).toContain('d={`M10 ${plusStart}v${plusSize}M${plusStart} 10h${plusSize}`}');
    expect(component).toContain('strokeWidth="1.5"');
    expect(component).toContain('strokeLinecap="round"');
  });

  it("tracks only the hovered side and resets its magnetic transform on leave", () => {
    expect(component).toContain("onPointerEnter={compact ? undefined : updatePointer}");
    expect(component).toContain("onPointerMove={compact ? undefined : updatePointer}");
    expect(component).toContain("onPointerLeave={compact ? undefined : resetPointer}");
    expect(component).toContain('visual.style.transition = "transform 80ms ease-out, opacity 200ms ease"');
    expect(component).toContain("scale(${motion.scale})");
    expect(component).not.toContain("group-hover");
    expect(component).not.toContain("forceVisible");
  });

  it("allows the multi-selection connector to stay visible without changing the shared magnetic motion", () => {
    expect(component).toContain("alwaysVisible?: boolean");
    expect(component).toContain('opacity: alwaysVisible ? 1 : "var(--canvas-handle-opacity, 0)"');
    expect(component).toContain("scale(${motion.scale})");
  });

  it("shares the same handle between material and text nodes without selected-force visibility", () => {
    expect(card).toContain('import { CanvasConnectionHandle } from "@/components/canvas/CanvasConnectionHandle"');
    expect(textNode).toContain('import { CanvasConnectionHandle } from "@/components/canvas/CanvasConnectionHandle"');
    expect(card).toContain("<CanvasConnectionHandle");
    expect(textNode.match(/<CanvasConnectionHandle/g)).toHaveLength(2);
    expect(card).not.toContain("CanvasMaterialConnectionHandle");
    expect(card).not.toContain("forceVisible=");
    expect(textNode).not.toContain("canvas-text-node-handle");
  });
});
