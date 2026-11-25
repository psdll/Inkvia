import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { $transaction: (fn: any) => fn({ $queryRaw: mocks.query }) } }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentCanvas: vi.fn() }));
import { executeCreativeAgentCanvasTool } from "@/lib/creative-agent/canvas-tools";

it("reads one authorized projected node without loading a 10000-node canvas or edges", async () => {
  const nodes = Array.from({ length: 10000 }, (_, i) => ({ id: `n${i}`, type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", title: "item", text: "body" } }));
  const rowsRead: number[] = [];
  mocks.query.mockImplementation(async (sql: any) => {
    if (sql.sql.includes('FROM "Canvas" canvas')) return [{ revision64: BigInt(10), projectionRevision: BigInt(10), canView: true, title: "test", settings: { gridSize: 20, snapToGrid: false } }];
    if (sql.sql.includes('FROM "CanvasEdgeState"')) throw new Error("unneeded edge scan");
    const selected = sql.sql.includes('"nodeId" IN') ? nodes.filter(n => sql.values.includes(n.id)) : nodes;
    rowsRead.push(selected.length); return selected.map(n => ({ nodeId: n.id, data: n }));
  });
  const result = await executeCreativeAgentCanvasTool({ actorUserId: 1, canvasId: 2, runId: "r", actionId: "a", epoch: 1, kind: "canvas.read", args: { nodeIds: ["n9999"] } });
  expect(result).toMatchObject({ total: 1, nodes: [{ id: "n9999", semanticHash: expect.any(String) }] });
  expect(rowsRead).toEqual([1]);
});
