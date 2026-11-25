import type { CanvasViewport } from "./document";
import { createCanvasFocusPreview } from "./focus-preview";

const transform = (view: CanvasViewport) => `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;

/** Animate pixels without broadcasting each frame through the graph store. */
export function animateCanvasFocus({ root, element, from, to, duration, apply, onEnd }: {
  root: HTMLElement;
  element: HTMLElement;
  from: CanvasViewport;
  to: CanvasViewport;
  duration: number;
  apply: (viewport: CanvasViewport) => void;
  onEnd: () => void;
}) {
  // Zooming out can reveal content outside the captured screen; retain the live
  // renderer for that case instead of showing empty preview margins.
  if (to.zoom <= from.zoom) return null;
  const preview = createCanvasFocusPreview(root, element, from, to);
  if (!preview) return null;
  const oldOpacity = element.style.opacity;
  const scale = to.zoom / from.zoom;
  // Stay inside the pane so the canvas toolbar remains above the preview.
  (element.parentElement ?? root).append(preview);
  root.setAttribute("data-canvas-focus-animating", "");
  // Nodes explicitly set visibility:visible, so inherited visibility cannot
  // hide them. Opacity hides the entire subtree without changing its geometry.
  element.style.opacity = "0";
  const animation = preview.animate([{ transform: "translate(0px, 0px) scale(1)" }, {
    transform: transform({ x: to.x - from.x * scale, y: to.y - from.y * scale, zoom: scale }),
  }], {
    duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both",
  });
  let ended = false;
  let released = false;
  let notifyOnRelease = false;
  let frame = 0;
  const cleanup = () => {
    window.removeEventListener("pointerdown", interrupt, true);
    window.removeEventListener("wheel", interrupt, true);
    window.removeEventListener("keydown", interrupt, true);
    window.removeEventListener("blur", interrupt);
    document.removeEventListener("visibilitychange", hidden);
  };
  const release = () => {
    if (released) return;
    released = true;
    cancelAnimationFrame(frame);
    root.removeAttribute("data-canvas-focus-animating");
    element.style.opacity = oldOpacity;
    animation.cancel();
    preview.remove();
    preview.width = preview.height = 0;
    if (notifyOnRelease) onEnd();
  };
  const finish = (view?: CanvasViewport, immediate = false) => {
    if (ended) return;
    ended = true;
    cleanup();
    // Keep the same displayed pixels until React commits the store update.
    if (view) element.style.transform = transform(view);
    if (view) { notifyOnRelease = true; apply(view); }
    if (!view || immediate) release();
    else frame = requestAnimationFrame(() => { frame = requestAnimationFrame(release); });
  };
  const interrupt = () => {
    if (ended) return;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(preview).transform);
    finish({ x: from.x * matrix.a + matrix.e, y: from.y * matrix.a + matrix.f, zoom: from.zoom * matrix.a }, true);
  };
  const hidden = () => { if (document.hidden) interrupt(); };
  window.addEventListener("pointerdown", interrupt, true);
  window.addEventListener("wheel", interrupt, { capture: true, passive: true });
  window.addEventListener("keydown", interrupt, true);
  window.addEventListener("blur", interrupt);
  document.addEventListener("visibilitychange", hidden);
  void animation.finished.then(() => finish(to), () => { if (!ended) interrupt(); });
  return { cancel: interrupt, dispose: () => { notifyOnRelease = false; finish(); release(); } };
}
