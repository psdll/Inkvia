/** Stay centered below the node, including when the panel extends outside the viewport. */
export function canvasTaskPanelPosition({ width, height, zoom, viewportHeight, panelWidth }: {
  x: number; y: number; width: number; height: number; zoom: number;
  viewportWidth: number; viewportHeight: number; panelWidth: number; panelHeight: number;
}) {
  const maxHeight = Math.max(80, viewportHeight - 104);
  return { left: (width - panelWidth / zoom) / 2, top: height + 16 / zoom, maxHeight };
}

/** Stay centered above the node even when the toolbar extends off screen. */
export function canvasMaterialToolbarPosition({ x, y, width, zoom, toolbarWidth, toolbarHeight, offset }: {
  x: number; y: number; width: number; zoom: number; viewportWidth: number; viewportHeight: number;
  toolbarWidth: number; toolbarHeight: number; offset: number;
}) {
  return {
    left: x + width * zoom / 2 - toolbarWidth / 2,
    top: y - offset - toolbarHeight,
  };
}
