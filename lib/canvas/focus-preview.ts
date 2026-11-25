import type { CanvasViewport } from "./document";

/** A disposable, screen-sized preview. Never serializes or uploads media pixels. */
export function createCanvasFocusPreview(root: HTMLElement, element: HTMLElement, view: CanvasViewport, destination = view) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || !root.clientWidth || !root.clientHeight) return null;
  const scale = destination.zoom / view.zoom;
  const dx = destination.x - view.x * scale, dy = destination.y - view.y * scale;
  const leftEdge = Math.floor(Math.min(0, -dx / scale)), topEdge = Math.floor(Math.min(0, -dy / scale));
  const rightEdge = Math.ceil(Math.max(root.clientWidth, (root.clientWidth - dx) / scale));
  const bottomEdge = Math.ceil(Math.max(root.clientHeight, (root.clientHeight - dy) / scale));
  const widthPx = rightEdge - leftEdge, heightPx = bottomEdge - topEdge;
  const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (widthPx * heightPx)));
  canvas.width = Math.ceil(widthPx * ratio);
  canvas.height = Math.ceil(heightPx * ratio);
  canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;transform-origin:0 0;will-change:transform;z-index:3";
  canvas.style.left = `${leftEdge}px`; canvas.style.top = `${topEdge}px`;
  canvas.style.transformOrigin = `${-leftEdge}px ${-topEdge}px`;
  canvas.style.width = `${widthPx}px`; canvas.style.height = `${heightPx}px`;
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-canvas-focus-preview", "");
  // Draw the same base curves once; do not rasterize a world-sized SVG layer.
  ctx.setTransform(ratio * view.zoom, 0, 0, ratio * view.zoom, ratio * (view.x - leftEdge), ratio * (view.y - topEdge));
  for (const path of element.querySelectorAll<SVGPathElement>(".canvas-edge-related-base")) {
    const d = path.getAttribute("d");
    if (!d) continue;
    const style = getComputedStyle(path);
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = parseFloat(style.strokeWidth) || 1.5;
    ctx.stroke(new Path2D(d));
  }
  ctx.setTransform(ratio, 0, 0, ratio, -leftEdge * ratio, -topEdge * ratio);
  const origin = root.getBoundingClientRect();
  for (const node of element.querySelectorAll<HTMLElement>(".react-flow__node")) {
    if (node.classList.contains("react-flow__node-group")) continue;
    const rect = node.getBoundingClientRect();
    const x = rect.left - origin.left, y = rect.top - origin.top;
    if (x + rect.width < leftEdge || y + rect.height < topEdge || x > rightEdge || y > bottomEdge) continue;
    ctx.fillStyle = "#1a1f27";
    ctx.fillRect(x, y, rect.width, rect.height);
    for (const media of node.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video")) {
      if (media.closest("[data-canvas-task-panel-anchor], [data-canvas-focus-toolbar]")) continue;
      const image = media instanceof HTMLImageElement;
      const width = image ? media.naturalWidth : media.videoWidth;
      const height = image ? media.naturalHeight : media.videoHeight;
      if (!width || !height || (image ? !media.complete : media.readyState < 2)) continue;
      const style = getComputedStyle(media);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const bounds = media.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const left = bounds.left - origin.left, top = bounds.top - origin.top;
      ctx.save();
      ctx.beginPath(); ctx.rect(left, top, bounds.width, bounds.height); ctx.clip();
      const scale = style.objectFit === "contain" ? Math.min(bounds.width / width, bounds.height / height)
        : style.objectFit === "cover" ? Math.max(bounds.width / width, bounds.height / height) : 0;
      try {
        if (scale) ctx.drawImage(media, left + (bounds.width - width * scale) / 2, top + (bounds.height - height * scale) / 2, width * scale, height * scale);
        else ctx.drawImage(media, left, top, bounds.width, bounds.height);
      } catch { /* A media element can unload between measurement and capture. */ }
      ctx.restore();
    }
  }
  return canvas;
}
