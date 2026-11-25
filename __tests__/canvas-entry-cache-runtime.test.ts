// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheCanvasProjects, clearCanvasEntries, loadCanvasForEntry, loadCanvasProjects, readCanvasProjects, warmCanvasProject } from "@/lib/client/canvas-entry";
import { clearCanvasEntrySnapshots, readCanvasEntrySnapshot, writeCanvasEntrySnapshot } from "@/lib/canvas/entry-snapshot";
vi.mock("@/lib/canvas/entry-previews", () => ({ warmCanvasViewport: vi.fn() }));
vi.mock("@/components/canvas/SmartCanvasBoard", () => ({ default: () => null }));
const value = { title: "cached", revision: "7", document: { schemaVersion: 2 as const, mode: "smart" as const, nodes: [], edges: [], viewport: { x: 1, y: 2, zoom: 1 }, settings: { snapToGrid: false, gridSize: 20 } } };
afterEach(() => { clearCanvasEntries(); clearCanvasEntrySnapshots(); vi.unstubAllGlobals(); });

describe("canvas entry caches", () => {
  it("makes the project list available to a fresh tab through owner-scoped storage", async () => {
    cacheCanvasProjects(9, [{ id: 1, publicId: "project", title: "跨标签页", revision: "1", sortOrder: 0, updatedAt: "2026-09-28" }]);
    vi.resetModules();
    const otherTab = await import("@/lib/client/canvas-entry");
    expect(otherTab.readCanvasProjects(9)?.[0].title).toBe("跨标签页");
    expect(otherTab.readCanvasProjects(10)).toBeUndefined();
  });
  it("shares list reads, keeps real project cards on return and isolates accounts", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, items: [{ id: 1, title: "project" }] })));
    vi.stubGlobal("fetch", fetcher);
    await Promise.all([loadCanvasProjects(1), loadCanvasProjects(1)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readCanvasProjects(1)?.[0].title).toBe("project");
    expect(readCanvasProjects(2)).toBeUndefined();
    window.dispatchEvent(new Event("auth:logout"));
    expect(readCanvasProjects(1)).toBeUndefined();
  });

  it("bounds retained documents and never shares snapshots across owners", async () => {
    await writeCanvasEntrySnapshot(1, 1, value);
    expect(await readCanvasEntrySnapshot(2, 1)).toBeUndefined();
    for (const id of [2, 3, 4]) await writeCanvasEntrySnapshot(1, id, value);
    expect(await readCanvasEntrySnapshot(1, 1)).toBeUndefined();
    expect((await readCanvasEntrySnapshot(1, 4))?.revision).toBe("7");
    window.dispatchEvent(new Event("auth:logout"));
    expect(await readCanvasEntrySnapshot(1, 4)).toBeUndefined();
  });

  it("validates persistent snapshots and takes changed content from the server", async () => {
    await writeCanvasEntrySnapshot(1, 1, value);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, revision: "8", title: "updated", ...value.document, nextNodeCursor: null, nextEdgeCursor: null })));
    vi.stubGlobal("fetch", fetcher);
    const loaded = await loadCanvasForEntry(1, 1);
    expect(fetcher.mock.calls[0][0]).toContain("knownRevision=7");
    expect(loaded.title).toBe("updated");
    expect(loaded.revision).toBe("8");
  });

  it("hover prefetch never claims an editing session or initializes legacy storage", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, revision: "8", title: "project", ...value.document, nextNodeCursor: null, nextEdgeCursor: null })));
    vi.stubGlobal("fetch", fetcher);
    warmCanvasProject(1, 55);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0][0]).toContain("prefetch=1");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/session"))).toBe(false);
  });
});
