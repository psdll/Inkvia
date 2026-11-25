/** Keep the newest input, with explicit end-of-gesture flush and cancellation. */
export function createCanvasInteractionFrame<T>(apply: (value: T) => void) {
  let frame = 0;
  let pending: { value: T } | null = null;
  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const input = pending;
    pending = null;
    if (input) apply(input.value);
  };
  return {
    push(value: T) {
      pending = { value };
      if (!frame) frame = requestAnimationFrame(flush);
    },
    flush,
    cancel() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
    },
  };
}
