export type IdleBatchOptions = {
  batchSize?: number;
  requestIdle?: (callback: () => void) => number;
  cancelIdle?: (handle: number) => void;
  isVisible?: () => boolean;
};

function defaultRequestIdle(callback: () => void): number {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(callback);
  }
  return globalThis.setTimeout(callback, 32) as unknown as number;
}

function defaultCancelIdle(handle: number) {
  if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

export function scheduleIdleBatches(
  total: number,
  onCount: (count: number) => void,
  options: IdleBatchOptions = {},
): () => void {
  const safeTotal = Math.max(0, Math.floor(total));
  const batchSize = Math.max(1, Math.floor(options.batchSize || 8));
  const requestIdle = options.requestIdle || defaultRequestIdle;
  const cancelIdle = options.cancelIdle || defaultCancelIdle;
  const isVisible = options.isVisible || (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  let count = 0;
  let cancelled = false;
  let handle: number | null = null;

  const schedule = () => {
    if (cancelled || count >= safeTotal) return;
    handle = requestIdle(run);
  };

  const run = () => {
    handle = null;
    if (cancelled) return;
    if (isVisible()) {
      count = Math.min(safeTotal, count + batchSize);
      onCount(count);
    }
    schedule();
  };

  schedule();
  return () => {
    cancelled = true;
    if (handle != null) cancelIdle(handle);
    handle = null;
  };
}
