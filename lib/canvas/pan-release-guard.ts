/** End the native mouse pan even if its mouseup was lost outside the canvas. */
export function bindCanvasPanReleaseGuard(onRelease: () => void) {
  let active: { button: number; mask: number; x: number; y: number } | null = null;
  const isMousePointer = (event: MouseEvent) => !('pointerType' in event) || !event.pointerType || event.pointerType === 'mouse';
  const finish = () => {
    const pan = active;
    if (!pan) return;
    active = null;
    // d3-zoom owns window mouse listeners. Reset its gesture as well as our UI;
    // toggling React's hand/interacting state alone leaves those listeners alive.
    window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, cancelable: true, view: window,
      button: pan.button, buttons: 0, clientX: pan.x, clientY: pan.y,
    }));
    onRelease();
  };
  const move = (event: MouseEvent) => {
    if (!active || !isMousePointer(event)) return;
    active.x = event.clientX; active.y = event.clientY;
    if (!(event.buttons & active.mask)) finish();
  };
  const pointerUp = (event: PointerEvent) => {
    if (active && event.button === active.button && isMousePointer(event)) finish();
  };
  const pointerCancel = (event: PointerEvent) => { if (isMousePointer(event)) finish(); };
  const mouseUp = (event: MouseEvent) => {
    if (active && event.button === active.button) {
      active = null; // The native mouseup itself reaches d3's capture listener.
      onRelease();
    }
  };
  const hidden = () => { if (document.hidden) finish(); };
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) finish(); };
  // Install before a gesture starts so zero-button mousemoves never reach a
  // stale d3 listener. Pointer events cover releases whose mouse event is lost.
  window.addEventListener("pointermove", move, true);
  window.addEventListener("mousemove", move, true);
  window.addEventListener("pointerup", pointerUp, true);
  window.addEventListener("mouseup", mouseUp, true);
  window.addEventListener("pointercancel", pointerCancel, true);
  window.addEventListener("blur", finish);
  window.addEventListener("keydown", escape, true);
  document.addEventListener("visibilitychange", hidden);
  return {
    isActive: () => active !== null,
    start(event: MouseEvent | TouchEvent | null) {
      if (event?.type !== "mousedown" || !("button" in event)) return;
      const mask = event.button === 0 ? 1 : event.button === 1 ? 4 : event.button === 2 ? 2 : 0;
      if (mask) active = { button: event.button, mask, x: event.clientX, y: event.clientY };
    },
    dispose() {
      finish();
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("pointerup", pointerUp, true);
      window.removeEventListener("mouseup", mouseUp, true);
      window.removeEventListener("pointercancel", pointerCancel, true);
      window.removeEventListener("blur", finish);
      window.removeEventListener("keydown", escape, true);
      document.removeEventListener("visibilitychange", hidden);
    },
  };
}
