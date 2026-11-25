export const CANVAS_EDGE_CUT_HIT_WIDTH_PX = 20;
export const CANVAS_EDGE_CUT_BUTTON_SIZE_PX = 48;
export const CANVAS_EDGE_CUT_ICON_SIZE_PX = 28;
export const CANVAS_EDGE_CUT_BORDER_WIDTH_PX = 1;

// These dimensions live in canvas coordinates and scale with the viewport.
export function getCanvasEdgeCutWorldGeometry() {
  return {
    hitWidth: CANVAS_EDGE_CUT_HIT_WIDTH_PX,
    buttonSize: CANVAS_EDGE_CUT_BUTTON_SIZE_PX,
    iconSize: CANVAS_EDGE_CUT_ICON_SIZE_PX,
    borderWidth: CANVAS_EDGE_CUT_BORDER_WIDTH_PX,
  };
}
