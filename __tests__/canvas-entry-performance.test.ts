import { describe, expect, it, vi } from "vitest";
import { loadCanvasBootstrap } from "@/lib/canvas/bootstrap-client";
import { readCanvasBootstrapPage } from "@/lib/canvas/prisma-mutation-store";

const document = { schemaVersion: 2 as const, mode: "smart" as const, nodes: [], edges: [], settings: { snapToGrid: false, gridSize: 20 }, viewport: { x: 1, y: 2, zoom: 1 } };
const cached = { title: "old", revision: "7", document };

describe("version-checked canvas entry", () => {
  it("reuses a complete snapshot only after the server validates its revision", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, notModified: true, revision: "7", title: "renamed", viewport: document.viewport, settings: document.settings })));
    const result = await loadCanvasBootstrap(53, fetcher, { cached });
    expect(fetcher.mock.calls[0][0]).toContain("knownRevision=7");
    expect(result.title).toBe("renamed");
    expect(result.document).toEqual(document);
  });

  it("does not fall back to private cached content after permission is revoked", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, code: "CANVAS_FORBIDDEN" }), { status: 403 }));
    await expect(loadCanvasBootstrap(53, fetcher, { cached })).rejects.toMatchObject({ status: 403 });
  });

  it("skips node and edge reads on a matching revision, but still checks access", async () => {
    const query = vi.fn().mockResolvedValue([{ revision64: BigInt(7), projectionRevision: BigInt(7), title: "new", settings: document.settings, viewport: document.viewport, canView: true }]);
    const client = { $transaction: (run: any) => run({ $queryRaw: query }) } as any;
    expect(await readCanvasBootstrapPage(client, { canvasId: 53, actorUserId: 1, knownRevision: BigInt(7) })).toMatchObject({ kind: "ok", notModified: true, title: "new" });
    expect(query).toHaveBeenCalledTimes(1);
    query.mockResolvedValue([{ revision64: BigInt(7), canView: false }]);
    expect(await readCanvasBootstrapPage(client, { canvasId: 53, actorUserId: 2, knownRevision: BigInt(7) })).toEqual({ kind: "forbidden" });
  });
});
