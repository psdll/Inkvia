import { describe, expect, it, vi } from "vitest";
import { scheduleIdleBatches } from "@/lib/browser/idle-batches";

describe("idle cache batches", () => {
  it("warms eight URLs at a time, pauses while hidden, and reaches 96", () => {
    const callbacks: Array<() => void> = [];
    let visible = true;
    const counts: number[] = [];
    const cancelIdle = vi.fn();
    const cancel = scheduleIdleBatches(96, (count) => counts.push(count), {
      requestIdle: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelIdle,
      isVisible: () => visible,
    });

    callbacks.shift()?.();
    callbacks.shift()?.();
    visible = false;
    callbacks.shift()?.();
    expect(counts).toEqual([8, 16]);

    visible = true;
    while (callbacks.length) callbacks.shift()?.();
    expect(counts).toEqual([8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96]);

    cancel();
    expect(cancelIdle).not.toHaveBeenCalled();
  });

  it("cancels a pending idle callback and prevents later work", () => {
    let callback: (() => void) | null = null;
    const onCount = vi.fn();
    const cancelIdle = vi.fn();
    const cancel = scheduleIdleBatches(16, onCount, {
      requestIdle: (next) => {
        callback = next;
        return 7;
      },
      cancelIdle,
      isVisible: () => true,
    });

    cancel();
    expect(cancelIdle).toHaveBeenCalledWith(7);
    (callback as (() => void) | null)?.();
    expect(onCount).not.toHaveBeenCalled();
  });
});
