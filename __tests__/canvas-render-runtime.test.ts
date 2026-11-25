import { describe, expect, it, vi } from "vitest";
import { canvasImageTier, CanvasWorkQueue, CanvasLru, CanvasMountQueue, CanvasVideoRetention } from "@/lib/canvas/render-runtime";

describe("canvas render runtime", () => {
  it("bounds decoded pixel memory even before the entry limit is reached", () => {
    const cache = new CanvasLru<{ pixels: number }>(100, 64 * 1024 * 1024, image => image.pixels * 4);
    const original = { pixels: 3840 * 2160 };
    cache.set("a", original); cache.set("b", original);
    cache.get("a"); cache.set("c", original);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(original);
    expect(cache.get("c")).toBe(original);
    cache.set("oversized", { pixels: 8000 * 8000 });
    expect(cache.get("oversized")).toBeUndefined();
    expect(cache.get("a")).toBe(original);
  });

  it("releases the old cache weight when a resource is replaced", () => {
    const cache = new CanvasLru<number>(10, 10, size => size);
    cache.set("a", 8); cache.set("a", 2); cache.set("b", 8);
    expect(cache.get("a")).toBe(2);
    expect(cache.get("b")).toBe(8);
    cache.set("b", 20); cache.set("c", 8);
    expect(cache.get("a")).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(8);
  });
  it("sizes previews by device pixels (retina capped at 2x) and keeps low detail/original rules", () => {
    expect(canvasImageTier(622, .5, 1.5, false, false)).toBe(800);
    expect(canvasImageTier(622, .1, 2, false, true)).toBe(400);
    expect(canvasImageTier(622, .5, 2, true, false)).toBe("original");
    expect(canvasImageTier(622, .4, 2, true, false)).toBe(800);
  });
  it("requests the smallest preview covering the on-screen pixels, originals beyond 1600px", () => {
    expect(canvasImageTier(350, .25, 2, false, false)).toBe(200);
    expect(canvasImageTier(350, .5, 2, false, false)).toBe(400);
    expect(canvasImageTier(350, .6, 2, false, false)).toBe(800);
    expect(canvasImageTier(622, .9, 3, false, false)).toBe(1600);
    expect(canvasImageTier(622, 1, 2, false, false)).toBe(1600);
    expect(canvasImageTier(622, 1.5, 2, false, false)).toBe("original");
    expect(canvasImageTier(622, 2, 1, false, false)).toBe(1600);
  });
  it("limits concurrency and cancels queued owners", async () => {
    const queue = new CanvasWorkQueue(2);
    const started: string[] = [];
    const finish: (() => void)[] = [];
    for (const id of ["a", "b", "c", "d"]) queue.add(id, () => new Promise<void>(resolve => { started.push(id); finish.push(resolve); }));
    expect(started).toEqual(["a", "b"]);
    queue.cancel("c"); queue.setLimit(1); finish.shift()!();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(started).toEqual(["a", "b"]);
    finish.shift()!(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(started).toEqual(["a", "b", "d"]);
    finish.shift()!();
  });
  it("bounds retained video elements and disposes the oldest", () => {
    const pool = new CanvasVideoRetention(2); const disposed: string[] = [];
    pool.retain("a", () => disposed.push("a")); pool.retain("b", () => disposed.push("b")); pool.retain("c", () => disposed.push("c"));
    expect(disposed).toEqual(["a"]); pool.release("b"); expect(disposed).toEqual(["a"]);
  });
  it("evicts least recently used decoded resources", () => {
    const cache = new CanvasLru<string>(2);
    cache.set("a", "a"); cache.set("b", "b"); cache.get("a"); cache.set("c", "c");
    expect(cache.get("b")).toBeUndefined(); expect(cache.get("a")).toBe("a");
  });
  it("mounts 30 initially, four per frame, one per frame while moving, and cancels", () => {
    const queue = new CanvasMountQueue(); let count = 0;
    for(let i=0;i<40;i++) queue.add(String(i), () => count++);
    expect(count).toBe(30); queue.cancel("30"); queue.flush(true); expect(count).toBe(31);
    queue.flush(false); expect(count).toBe(35); queue.flush(false); expect(count).toBe(39);
    queue.flush(false); expect(count).toBe(39);
  });
  it("releases admission when a node leaves rather than accumulating ready nodes", () => {
    const queue = new CanvasMountQueue();
    for (let i = 0; i < 30; i++) {
      queue.add(String(i), () => {});
      queue.cancel(String(i));
      expect(queue.has(String(i))).toBe(false);
    }
    const mount = vi.fn(); queue.add("99", mount, true);
    expect(mount).not.toHaveBeenCalled();
    queue.flush(false); expect(mount).toHaveBeenCalledOnce();
    queue.cancel("99"); expect(queue.has("99")).toBe(false);
  });
});
