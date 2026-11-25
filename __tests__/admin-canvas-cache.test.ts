import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminCanvasCache, adminCanvasCache, loadAdminCanvas } from "@/lib/admin-canvas-cache";
import { warmCanvasViewport } from "@/lib/canvas/entry-previews";
vi.mock("@/lib/canvas/entry-previews", () => ({ warmCanvasViewport: vi.fn() }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); adminCanvasCache.clear(); });
describe("admin canvas cache", () => {
  it("isolates owners, coalesces requests and refreshes on demand", async () => {
    const cache = new AdminCanvasCache();
    const read = vi.fn(async () => ({ revision: 1 }));
    const [a, b] = await Promise.all([cache.load("auth:1:7", read), cache.load("auth:1:7", read)]);
    expect(a).toBe(b); expect(read).toHaveBeenCalledTimes(1);
    await cache.load("auth:1:7", read); expect(read).toHaveBeenCalledTimes(1);
    await cache.load("auth:2:7", read); expect(read).toHaveBeenCalledTimes(2);
    await cache.load("auth:1:7", read, true); expect(read).toHaveBeenCalledTimes(3);
  });
  it("expires and evicts cached graphs within count and memory limits", async () => {
    vi.useFakeTimers();
    const cache = new AdminCanvasCache(2, 50, 1000);
    await cache.load("a", async () => "a"); await cache.load("b", async () => "b");
    cache.peek("a"); await cache.load("c", async () => "c");
    expect(cache.peek("b")).toBeUndefined(); expect(cache.peek("a")).toBe("a");
    await cache.load("huge", async () => "x".repeat(100)); expect(cache.peek("huge")).toBeUndefined();
    vi.advanceTimersByTime(1001); expect(cache.peek("a")).toBeUndefined();
  });
  it("does not repopulate a cleared session with an old pending response", async () => {
    const cache = new AdminCanvasCache();
    let resolve!: (value: string) => void;
    const request = cache.load("a", () => new Promise<string>(done => { resolve = done; }));
    cache.clear(); resolve("private"); await request; expect(cache.peek("a")).toBeUndefined();
  });
  it("does not cache failures", async () => {
    const cache = new AdminCanvasCache();
    await expect(cache.load("a", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await cache.load("a", async () => "ok")).toBe("ok");
  });
  it("loads graph pages through admin scope, never the user editor API", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ success: true, title: "A", revision: "1", settings: { snapToGrid: false, gridSize: 20 }, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], nextNodeCursor: null, nextEdgeCursor: null })));
    vi.stubGlobal("fetch", fetcher);
    await loadAdminCanvas("auth:12", 7);
    expect(fetcher.mock.calls[0][0]).toContain("/api/admin/user/canvases?");
    expect(fetcher.mock.calls[0][0]).toContain("adminKey=auth%3A12");
    expect(fetcher.mock.calls[0][0]).toContain("canvasId=7");
  });
  it("warms previews in observer scope and revalidates expired snapshots without losing their graph", async () => {
    vi.useFakeTimers();
    const page = { success: true, title: "A", revision: "7", settings: { snapToGrid: false, gridSize: 20 }, viewport: { x: 0, y: 0, zoom: .5 }, nodes: [], edges: [], nextNodeCursor: null, nextEdgeCursor: null };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...page, notModified: true, title: "Updated" })));
    vi.stubGlobal("fetch", fetcher);
    const first = await loadAdminCanvas("auth:12", 7);
    expect(warmCanvasViewport).toHaveBeenCalledWith(-12, 7, [], page.viewport);
    vi.advanceTimersByTime(30_001);
    const next = await loadAdminCanvas("auth:12", 7);
    expect(fetcher.mock.calls[1][0]).toContain("knownRevision=7");
    expect(next.document.nodes).toBe(first.document.nodes);
    expect(next.title).toBe("Updated");
  });
});
