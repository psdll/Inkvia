/**
 * Browsers fire `dblclick` within the operating system's double-click interval, which
 * can be a second or more (macOS "Double-click speed"). On the canvas two deliberate,
 * separate clicks must never zoom into a node, so double-click actions also require the
 * two presses themselves to be quick and in the same place.
 */
const MAX_INTERVAL_MS = 350;
const MAX_DISTANCE_PX = 10;
/** A `dblclick` with no press right before it was synthesized (keyboard, tests): allow it. */
const SYNTHETIC_AFTER_MS = 1000;

type Press = { time: number; x: number; y: number };
let previous: Press | null = null;
let last: Press | null = null;
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    previous = last;
    last = { time: event.timeStamp, x: event.clientX, y: event.clientY };
  }, { capture: true, passive: true });
}

install();

export function isDeliberateDoubleClick(event: { timeStamp: number }) {
  install();
  if (!last || event.timeStamp - last.time > SYNTHETIC_AFTER_MS) return true;
  if (!previous) return false;
  return last.time - previous.time <= MAX_INTERVAL_MS
    && Math.hypot(last.x - previous.x, last.y - previous.y) <= MAX_DISTANCE_PX;
}
