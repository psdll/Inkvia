import { describe, expect, it } from "vitest";
import { canvasMaterialToolbarPosition, canvasTaskPanelPosition } from "@/lib/canvas/node-overlay-position";
import { getCanvasTextTaskFrameSize } from "@/lib/canvas/text-node";

describe("task editor node anchoring", () => {
  const base = { x: 200, y: 100, width: 622, height: 350, zoom: 1, viewportWidth: 1355, viewportHeight: 792, panelWidth: 660, panelHeight: 272 };
  it("anchors beneath the actual idle and completed text frames at 33% zoom", () => {
    for (const status of ["idle", "success"] as const) {
      const frame = getCanvasTextTaskFrameSize({ kind: "llm", status } as Parameters<typeof getCanvasTextTaskFrameSize>[0]);
      const result = canvasTaskPanelPosition({ ...base, ...frame, zoom: .33 });
      expect((result.top - frame.height) * .33).toBeCloseTo(16);
      expect(result.left * .33 + base.panelWidth / 2).toBeCloseTo(frame.width * .33 / 2);
    }
  });
  it("keeps the normal below-node placement and a 16px screen gap", () => {
    const result = canvasTaskPanelPosition({ ...base, y: 20 });
    expect(result.left).toBe(-19);
    expect(result.top).toBe(366);
  });
  it("keeps the editor below the node near the bottom at 200% zoom", () => {
    const input = { ...base, x: 1119.83, y: 301.5, zoom: 2 };
    const result = canvasTaskPanelPosition(input);
    expect(result.left * input.zoom + input.x).toBeCloseTo(1411.83);
    expect(result.top * input.zoom + input.y).toBeCloseTo(1017.5);
  });
  it.each([.1, .2, .5, 1, 2, 8])("keeps a 16px gap below the node at zoom %s", zoom => {
    for (const x of [-1500, 0, 500, 1300]) for (const y of [-2000, 0, 600]) {
      const result = canvasTaskPanelPosition({ ...base, x, y, zoom });
      const left = x + result.left * zoom, top = y + result.top * zoom;
      expect(left + base.panelWidth / 2).toBeCloseTo(x + base.width * zoom / 2);
      expect(top - (y + base.height * zoom)).toBeCloseTo(16);
    }
  });
  it("lets the panel extend past the left edge at 37% zoom instead of pushing it away from its node", () => {
    const input = { ...base, x: -50, width: 350, zoom: .37 };
    const result = canvasTaskPanelPosition(input);
    expect(input.x + result.left * input.zoom).toBeCloseTo(-315.25);
    expect(canvasTaskPanelPosition({ ...input, x: 800, viewportWidth: 900 }).left).toBe(result.left);
  });
  it("limits tall editors on short screens without moving them above the node", () => {
    const result = canvasTaskPanelPosition({ ...base, viewportHeight: 400, panelHeight: 600 });
    expect(result.maxHeight).toBe(296);
    expect(result.top + base.y).toBe(466);
  });
  it("keeps the same anchor when the user expands the editor", () => {
    const collapsed = canvasTaskPanelPosition(base);
    const expanded = canvasTaskPanelPosition({ ...base, panelHeight: 516 });
    expect(expanded).toEqual(collapsed);
  });
  it("keeps the toolbar above an offscreen node at 400% instead of pinning it to the screen edge", () => {
    const position = canvasMaterialToolbarPosition({ x: -814.85, y: -276, width: 627, zoom: 4,
      viewportWidth: 1561, viewportHeight: 712, toolbarWidth: 531, toolbarHeight: 50, offset: 36 });
    expect(position.left).toBeCloseTo(173.65);
    expect(position.top).toBe(-362);
  });

  it.each([.1, .22, .5, 1, 2, 4, 8])("keeps all material toolbars attached to the node at viewport edges at zoom %s", zoom => {
    for (const x of [-1500, -20, 1300, 2500]) for (const y of [-2000, 0, 750, 1800]) {
      const input = { x, y, width: 350, zoom, viewportWidth: 1355, viewportHeight: 792, toolbarWidth: 620, toolbarHeight: 50, offset: 36 };
      const result = canvasMaterialToolbarPosition(input);
      expect(result.left + input.toolbarWidth / 2).toBeCloseTo(x + input.width * zoom / 2);
      expect(result.top + input.toolbarHeight).toBe(y - input.offset);
      const moved = canvasMaterialToolbarPosition({ ...input, x: x + 400, y: y + 300 });
      expect(moved.left - result.left).toBeCloseTo(400);
      expect(moved.top - result.top).toBe(300);
      expect(canvasMaterialToolbarPosition({ ...input, viewportWidth: 320, viewportHeight: 240 })).toEqual(result);
    }
  });
});
