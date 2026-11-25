import { describe, expect, it, vi } from "vitest";
import { createMarqueeFrame, createMarqueeIndex, sampledPathIntersectsRect, stableMarqueeIds } from "@/lib/canvas/marquee-selection";

describe("canvas marquee runtime", () => {
  it("intersects strict bounds and selects a group using its direct child extent", () => {
    const search = createMarqueeIndex([
      { id: "group", x: 0, y: 0, width: 100, height: 100 },
      { id: "child", parentId: "group", x: 120, y: 20, width: 50, height: 50 },
      { id: "hidden", hidden: true, x: 120, y: 20, width: 50, height: 50 },
      { id: "locked", selectable: false, x: 120, y: 20, width: 50, height: 50 },
    ]);
    expect(search({ x: 130, y: 30, width: 10, height: 10 })).toEqual(["group"]);
    expect(search({ x: 170, y: 30, width: 10, height: 10 })).toEqual([]);
  });
  it("retains state identity when only hit order differs", () => {
    const selected = ["a", "b"];
    expect(stableMarqueeIds(selected, ["b", "a"])).toBe(selected);
    expect(stableMarqueeIds(selected, ["a"])).not.toBe(selected);
  });
  it("selects only direct members when a marquee starts inside a group", () => {
    const nodes = [
      { id: "g", x: 0, y: 0, width: 800, height: 600 },
      { id: "a", parentId: "g", x: 100, y: 100, width: 100, height: 100 },
      { id: "b", parentId: "g", x: 300, y: 100, width: 100, height: 100 },
      { id: "nested", parentId: "g", x: 100, y: 350, width: 200, height: 150 },
      { id: "nested-child", parentId: "nested", x: 140, y: 380, width: 100, height: 100 },
      { id: "outside", x: 850, y: 100, width: 100, height: 100 },
      { id: "hidden", parentId: "g", hidden: true, x: 100, y: 100, width: 100, height: 100 },
    ];
    expect(createMarqueeIndex(nodes, "g")({ x: 80, y: 80, width: 900, height: 150 })).toEqual(["a", "b"]);
    expect(createMarqueeIndex(nodes, "nested")({ x: 80, y: 80, width: 900, height: 500 })).toEqual(["nested-child"]);
    expect(createMarqueeIndex(nodes)({ x: 80, y: 80, width: 900, height: 500 })).toEqual(["g", "outside"]);
  });
  it("coalesces movement, flushes the latest release and cancels stale frames", () => {
    let callback = () => {};
    const publish = vi.fn();
    const request = vi.fn((next: () => void) => { callback = next; return 1; });
    const cancel = vi.fn();
    const frame = createMarqueeFrame(publish, request, cancel);
    frame.push(1); frame.push(2);
    expect(request).toHaveBeenCalledTimes(1);
    callback();
    expect(publish).toHaveBeenLastCalledWith(2);
    frame.push(3); frame.flush(); callback();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(3);
    frame.push(4); frame.cancel(); callback();
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("hits the sampled middle of an edge while endpoints lie outside", () => {
    expect(sampledPathIntersectsRect([{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }], { x: 45, y: 75, width: 10, height: 10 })).toBe(true);
    expect(sampledPathIntersectsRect([{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 45, y: 75, width: 10, height: 10 })).toBe(false);
  });
  it("hits a crossing segment even when no sample is inside the small marquee", () => {
    const rect = { x: 45, y: 45, width: 10, height: 10 };
    expect(sampledPathIntersectsRect([{ x: -10000, y: 50 }, { x: 30000, y: 50 }], rect)).toBe(true);
    expect(sampledPathIntersectsRect([{ x: 0, y: 0 }, { x: 100, y: 100 }], rect)).toBe(true);
    expect(sampledPathIntersectsRect([{ x: 0, y: 0 }, { x: 100, y: 20 }], rect)).toBe(false);
    expect(sampledPathIntersectsRect([{ x: 50, y: 0 }, { x: 50, y: 30 }], rect)).toBe(false);
    expect(sampledPathIntersectsRect([], rect)).toBe(false);
  });
});
