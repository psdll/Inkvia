import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ default: { canvas: { findMany: mocks.findMany, findFirst: mocks.findFirst } } }));
vi.mock("@/lib/canvas/prisma-mutation-store", () => ({ readCanvasBootstrapPage: mocks.read, CanvasProjectionStateError: class extends Error {} }));
import { GET } from "@/app/api/admin/user/canvases/route";
const request = (query: string) => new NextRequest(`http://localhost/api/admin/user/canvases?${query}`);
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ ok: true }); });

describe("admin canvas read boundary", () => {
  it("requires admin authentication before any query", async () => {
    mocks.auth.mockReturnValue({ ok: false, error: "UNAUTHORIZED" });
    expect((await GET(request("adminKey=auth:7"))).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("keeps numeric guest identities separate from registered accounts", async () => {
    expect(await (await GET(request("adminKey=guest:7"))).json()).toEqual({ items: [], hasMore: false });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("lists lightweight owned metadata with bounded pagination", async () => {
    mocks.findMany.mockResolvedValue([{ id: 1, title: "A", revision64: BigInt("9007199254740993") }]);
    const response = await GET(request("adminKey=auth:7&page=2&q=海报"));
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect((await response.json()).items[0].revision).toBe("9007199254740993");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { authUserId: 7, deletedAt: null, title: { contains: "海报", mode: "insensitive" } }, skip: 30, take: 31 }));
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty("data");
  });
  it("rejects a canvas belonging to another account", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await GET(request("adminKey=auth:7&canvasId=9"))).status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, authUserId: 7, deletedAt: null } }));
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("uses read-only bootstrap and propagates revision conflicts", async () => {
    mocks.findFirst.mockResolvedValue({ id: 9 }); mocks.read.mockResolvedValue({ kind: "conflict", currentRevision: "3" });
    const response = await GET(request("adminKey=auth:7&canvasId=9&baseRevision=2&nodeCursor=n"));
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("BOOTSTRAP_REVISION_CHANGED");
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ canvasId: 9, actorUserId: 7, readOnly: true, baseRevision: BigInt(2), nodeCursor: "n" }));
  });
  it("uses the editor's bounded page size and validates a cached revision without graph transfer", async () => {
    mocks.findFirst.mockResolvedValue({ id: 9 });
    mocks.read.mockResolvedValue({ kind: "ok", notModified: true, revision: "7", nodes: [], edges: [] });
    const response = await GET(request("adminKey=auth:7&canvasId=9&knownRevision=7&limit=1000"));
    expect(await response.json()).toMatchObject({ success: true, notModified: true });
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ readOnly: true, knownRevision: BigInt(7), limit: 1000 }));
    await GET(request("adminKey=auth:7&canvasId=9&limit=99999"));
    expect(mocks.read.mock.lastCall?.[1].limit).toBe(1000);
  });
  it("rejects malformed cached revisions", async () => {
    mocks.findFirst.mockResolvedValue({ id: 9 });
    expect((await GET(request("adminKey=auth:7&canvasId=9&knownRevision=bad"))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
