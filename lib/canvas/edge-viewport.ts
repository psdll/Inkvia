type EdgeViewport = { transform: readonly [number, number, number]; width: number; height: number };

export function canvasEdgeViewportGeometry({ transform: [x, y, zoom], width, height }: EdgeViewport) {
  if (!(zoom > 0 && width > 0 && height > 0) || ![x, y, zoom, width, height].every(Number.isFinite)) return null;
  const padding = 256 / zoom;
  const left = -x / zoom - padding, top = -y / zoom - padding;
  const worldWidth = width / zoom + padding * 2, worldHeight = height / zoom + padding * 2;
  return {
    transform: `translate(${left}px, ${top}px)`,
    viewBox: `${left} ${top} ${worldWidth} ${worldHeight}`,
    width: `${worldWidth}px`, height: `${worldHeight}px`,
    left, top, right: left + worldWidth, bottom: top + worldHeight, zoom,
  };
}

/** Cache only a screen-sized edge tile while preserving SVG world coordinates. */
export function bindCanvasEdgeViewport(edges: HTMLDivElement, read: () => EdgeViewport) {
  const properties = ["clip-path", "width", "height", "transform", "--canvas-edge-unit", "--canvas-edge-raster-zoom", "--canvas-edge-offset-x", "--canvas-edge-offset-y"];
  const original = properties.map(name => [name, edges.style.getPropertyValue(name)] as const);
  const originalAttribute = edges.getAttribute("data-canvas-edge-viewport");
  edges.setAttribute("data-canvas-edge-viewport", "");
  edges.style.clipPath = "none";
  let previousUnit = "";
  let previous = "";
  let tile: ReturnType<typeof canvasEdgeViewportGeometry> = null;
  const update = () => {
    const viewport = read();
    const [x, y, zoom] = viewport.transform;
    if (!(zoom > 0 && viewport.width > 0 && viewport.height > 0)
      || ![x, y, zoom, viewport.width, viewport.height].every(Number.isFinite)) return;
    // Keep overview hairlines, but stop growing strokes above 100% zoom.
    const unit = `${1 / Math.max(1, zoom)}px`;
    if (unit !== previousUnit) {
      edges.style.setProperty("--canvas-edge-unit", unit);
      previousUnit = unit;
    }
    // Reuse the overscan during panning. Child SVGs always retain their native
    // coordinates, including children mounted during viewport culling.
    if (!tile || zoom < tile.zoom * .75 || zoom > tile.zoom * 1.5
      || -x / zoom < tile.left || -y / zoom < tile.top
      || (viewport.width - x) / zoom > tile.right || (viewport.height - y) / zoom > tile.bottom) {
      tile = canvasEdgeViewportGeometry(viewport);
    }
    if (!tile) return;
    const { left, top, right, bottom, zoom: rasterZoom } = tile;
    const key = `${left},${top},${right},${bottom},${rasterZoom}`;
    if (key === previous) return;
    previous = key;
    // The parent cancels the tile scale; each child SVG applies its inverse.
    // Paths, hit targets and getScreenCTM retain their original projection, but
    // the composited surface is bounded in screen pixels instead of world size.
    edges.style.width = `${(right - left) * rasterZoom}px`;
    edges.style.height = `${(bottom - top) * rasterZoom}px`;
    edges.style.transform = `translate(${left}px, ${top}px) scale(${1 / rasterZoom})`;
    edges.style.setProperty("--canvas-edge-raster-zoom", `${rasterZoom}`);
    edges.style.setProperty("--canvas-edge-offset-x", `${-left}px`);
    edges.style.setProperty("--canvas-edge-offset-y", `${-top}px`);
  };
  update();
  return { update, dispose() {
    for (const [name, value] of original) {
      if (value) edges.style.setProperty(name, value);
      else edges.style.removeProperty(name);
    }
    if (originalAttribute === null) edges.removeAttribute("data-canvas-edge-viewport");
    else edges.setAttribute("data-canvas-edge-viewport", originalAttribute);
  } };
}
