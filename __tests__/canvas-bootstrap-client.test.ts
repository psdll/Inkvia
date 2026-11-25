import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCanvasBootstrap } from "@/lib/canvas/bootstrap-client";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("canvas bootstrap client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("assembles stable projection pages into a document", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, {
        success: true,
        title: "Large canvas",
        revision: "21",
        settings: { snapToGrid: false, gridSize: 20 },
        viewport: { x: 1, y: 2, zoom: 0.5 },
        nodes: [{ id: "a", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "a" } }],
        edges: [],
        nextNodeCursor: "a",
        nextEdgeCursor: null,
      }))
      .mockResolvedValueOnce(response(200, {
        success: true,
        title: "Large canvas",
        revision: "21",
        settings: { snapToGrid: false, gridSize: 20 },
        viewport: { x: 1, y: 2, zoom: 0.5 },
        nodes: [{ id: "b", type: "prompt", position: { x: 1, y: 1 }, data: { kind: "prompt", text: "b" } }],
        edges: [{ id: "e1", source: "a", target: "b" }],
        nextNodeCursor: null,
        nextEdgeCursor: null,
      }));

    const loaded = await loadCanvasBootstrap(7, fetcher);

    expect(loaded.title).toBe("Large canvas");
    expect(loaded.revision).toBe("21");
    expect(loaded.document.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(loaded.document.edges.map((edge) => edge.id)).toEqual(["e1"]);
    expect(fetcher.mock.calls[1][0]).toContain("baseRevision=21");
  });

  it("restarts from page one if the revision changes between pages", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, {
        success: true,
        title: "Canvas",
        revision: "4",
        settings: { snapToGrid: false, gridSize: 20 },
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [], edges: [], nextNodeCursor: "a", nextEdgeCursor: null,
      }))
      .mockResolvedValueOnce(response(409, { success: false, code: "BOOTSTRAP_REVISION_CHANGED", currentRevision: "5" }))
      .mockResolvedValueOnce(response(200, {
        success: true,
        title: "Canvas",
        revision: "5",
        settings: { snapToGrid: false, gridSize: 20 },
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{ id: "current", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "current" } }],
        edges: [], nextNodeCursor: null, nextEdgeCursor: null,
      }));

    const loaded = await loadCanvasBootstrap(7, fetcher);
    expect(loaded.revision).toBe("5");
    expect(loaded.document.nodes.map((node) => node.id)).toEqual(["current"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("shares one default request between concurrent editor mounts", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, {
      success: true,
      title: "Canvas",
      revision: "9",
      settings: { snapToGrid: false, gridSize: 20 },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      nextNodeCursor: null,
      nextEdgeCursor: null,
    }));
    vi.stubGlobal("fetch", fetcher);

    const [first, second] = await Promise.all([
      loadCanvasBootstrap(91),
      loadCanvasBootstrap(91),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });
});
