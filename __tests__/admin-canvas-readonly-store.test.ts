import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { readCanvasBootstrapPage } from "@/lib/canvas/prisma-mutation-store";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";

describe("admin legacy canvas bootstrap", () => {
  it("paginates old documents without initializing or writing projections", async () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = ["b", "a"].map(id => ({ id, type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: id } }));
    const query = vi.fn().mockResolvedValueOnce([{ revision64: BigInt(1), projectionRevision: BigInt(0), title: "legacy", canView: true }]).mockResolvedValueOnce([{ data: document }]);
    const execute = vi.fn();
    const client = { $transaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: query, $executeRaw: execute }) } as unknown as PrismaClient;
    const result = await readCanvasBootstrapPage(client, { canvasId: 1, actorUserId: 7, readOnly: true, limit: 1 });
    expect(result).toMatchObject({ kind: "ok", nodes: [{ id: "a" }], nextNodeCursor: "a", projectionRevision: "0" });
    expect(execute).not.toHaveBeenCalled(); expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.flat().map(value => value.strings.join(" ")).join(" ")).not.toMatch(/FOR UPDATE|INSERT|UPDATE|DELETE/);
  });
});
