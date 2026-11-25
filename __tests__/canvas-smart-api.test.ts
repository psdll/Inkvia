import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  requireCanvasEntryEnabled: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  runUpdateMany: vi.fn(),
  stepUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/prisma", () => ({ default: {
  canvas: { findMany: mocks.findMany, create: mocks.create, findFirst: mocks.findFirst, update: mocks.update, updateMany: mocks.updateMany },
  canvasRun: { updateMany: mocks.runUpdateMany },
  canvasRunStep: { updateMany: mocks.stepUpdateMany },
  $transaction: mocks.transaction,
} }));

function request(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;
}

describe("smart-only canvas APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ id: 11, title: "智能画布", revision: 1, updatedAt: new Date() });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.runUpdateMany.mockResolvedValue({ count: 0 });
    mocks.stepUpdateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      canvas: { updateMany: mocks.updateMany, findFirst: mocks.findFirst, create: mocks.create },
      canvasRun: { updateMany: mocks.runUpdateMany },
      canvasRunStep: { updateMany: mocks.stepUpdateMany },
    }));
  });

  it("filters list reads to smart documents", async () => {
    const { GET } = await import("@/app/api/canvas/route");
    await GET({ nextUrl: new URL("http://localhost/api/canvas") } as any);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ authUserId: 7, data: { path: ["mode"], equals: "smart" } }),
      select: expect.objectContaining({ revision64: true, publicId: true }),
    }));
  });

  it("assigns identity and ownership on the server when creating a canvas", async () => {
    const publicId = "dc7c2098ed2049c7b15e6f8c0f55f342";
    mocks.create.mockResolvedValueOnce({ id: 11, publicId });
    const { POST } = await import("@/app/api/canvas/route");
    const response = await POST(request("http://localhost/api/canvas", "POST", { authUserId: 99, publicId: "client-chosen-id" }));
    expect(await response.json()).toMatchObject({ success: true, id: 11, publicId });
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.authUserId).toBe(7);
    expect(data).not.toHaveProperty("publicId");
  });

  it("duplicates content with a new database-generated public identifier", async () => {
    const sourceId = "dc7c2098ed2049c7b15e6f8c0f55f342";
    const copyId = "ee2190941bd14edaaa19adfc636b9a46";
    mocks.findFirst.mockResolvedValueOnce({ title: "source", data: { mode: "smart", nodes: [] }, settings: {}, sortOrder: 0, publicId: sourceId, projectionRevision: BigInt(0) });
    mocks.create.mockResolvedValueOnce({ id: 12, publicId: copyId, title: "source - 副本" });
    const { POST } = await import("@/app/api/canvas/[id]/duplicate/route");
    const response = await POST(request("http://localhost/api/canvas/11/duplicate", "POST"), { params: { id: "11" } });
    expect(await response.json()).toMatchObject({ success: true, canvas: { id: 12, publicId: copyId } });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11, authUserId: 7, deletedAt: null } }));
    expect(mocks.create.mock.calls[0][0].data).not.toHaveProperty("publicId");
    expect(mocks.create.mock.calls[0][0].select.publicId).toBe(true);
  });

  it("cannot duplicate another user's canvas", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/canvas/[id]/duplicate/route");
    const response = await POST(request("http://localhost/api/canvas/11/duplicate", "POST"), { params: { id: "11" } });
    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11, authUserId: 7, deletedAt: null } }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not list or create canvases without a logged-in user", async () => {
    mocks.getUserId.mockResolvedValue(null);
    const { GET, POST } = await import("@/app/api/canvas/route");
    expect((await GET(request("http://localhost/api/canvas"))).status).toBe(401);
    expect((await POST(request("http://localhost/api/canvas", "POST"))).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns the persisted smart revision on canvas cards", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: 11, title: "智能画布", revision64: BigInt(524), updatedAt: new Date() },
    ]);
    const { GET } = await import("@/app/api/canvas/route");
    const response = await GET({ nextUrl: new URL("http://localhost/api/canvas") } as any);

    expect(await response.json()).toMatchObject({
      success: true,
      items: [{ id: 11, revision: "524" }],
    });
  });

  it("always creates an empty smart document even when legacy data is submitted", async () => {
    const { POST } = await import("@/app/api/canvas/route");
    const response = await POST(request("http://localhost/api/canvas", "POST", { data: { mode: "node", nodes: [{ id: "legacy" }] } }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ id: true, publicId: true }),
      data: expect.objectContaining({
        title: "未命名项目",
        data: { schemaVersion: 2, mode: "smart", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: { snapToGrid: false, gridSize: 20 } },
      }),
    }));
  });

  it("never reads a smart canvas after it has moved to trash", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/canvas/[id]/route");
    const response = await GET(request("http://localhost/api/canvas/11"), { params: { id: "11" } });

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 11, authUserId: 7, deletedAt: null }),
    }));
  });

  it("cancels queued and active work when moving a canvas to trash", async () => {
    const { DELETE } = await import("@/app/api/canvas/[id]/route");
    const response = await DELETE(request("http://localhost/api/canvas/11", "DELETE"), { params: { id: "11" } });

    expect(response.status).toBe(200);
    expect(mocks.stepUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ run: { is: { canvasId: 11 } } }),
      data: expect.objectContaining({ status: "cancelled", leaseOwner: null, leaseUntil: null }),
    }));
    expect(mocks.runUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ canvasId: 11 }),
      data: expect.objectContaining({ status: "cancelled", finishedAt: expect.any(Date) }),
    }));
  });

  it("restores only a canvas that is still present in trash", async () => {
    const { POST } = await import("@/app/api/canvas/[id]/restore/route");
    const response = await POST(request("http://localhost/api/canvas/11/restore", "POST"), { params: { id: "11" } });

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 11, authUserId: 7, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  });

  it("returns the visible default title for legacy canvas rows", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: 11, title: "未命名画布", revision64: BigInt(1), updatedAt: new Date() },
    ]);
    const { GET } = await import("@/app/api/canvas/route");
    const response = await GET({ nextUrl: new URL("http://localhost/api/canvas") } as any);

    expect(await response.json()).toMatchObject({
      success: true,
      items: [{ id: 11, title: "未命名项目" }],
    });
  });

  it("normalizes blank titles before saving", async () => {
    const data = {
      schemaVersion: 2,
      mode: "smart",
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    };
    mocks.findFirst.mockResolvedValueOnce({ id: 11, title: "未命名项目", revision: 2, updatedAt: new Date() });
    const { PUT } = await import("@/app/api/canvas/[id]/route");
    const response = await PUT(request("http://localhost/api/canvas/11", "PUT", {
      baseRevision: 1,
      title: "   ",
      data,
    }), { params: { id: "11" } });

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: "未命名项目" }),
    }));
  });

  it("rejects ordinary canvas writes before touching the database", async () => {
    const { PUT } = await import("@/app/api/canvas/[id]/route");
    const response = await PUT(request("http://localhost/api/canvas/11", "PUT", { data: { mode: "node", nodes: [] } }), { params: { id: "11" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: "仅支持智能画布 V2" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("updates a V2 document only when baseRevision matches", async () => {
    const data = {
      schemaVersion: 2,
      mode: "smart",
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    };
    mocks.findFirst.mockResolvedValueOnce({ id: 11, title: "智能画布", revision: 4, updatedAt: new Date() });
    const { PUT } = await import("@/app/api/canvas/[id]/route");
    const response = await PUT(request("http://localhost/api/canvas/11", "PUT", { baseRevision: 3, data }), { params: { id: "11" } });

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 11, authUserId: 7, revision: 3 }),
      data: expect.objectContaining({ data, revision: { increment: 1 } }),
    }));
    expect(await response.json()).toMatchObject({ success: true, revision: 4 });
  });

  it("returns the latest server document on a revision conflict", async () => {
    const serverData = {
      schemaVersion: 2,
      mode: "smart",
      nodes: [],
      edges: [],
      viewport: { x: 10, y: 20, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    };
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findFirst.mockResolvedValueOnce({ id: 11, revision: 8, data: serverData, updatedAt: new Date() });
    const { PUT } = await import("@/app/api/canvas/[id]/route");
    const response = await PUT(request("http://localhost/api/canvas/11", "PUT", {
      baseRevision: 7,
      data: { ...serverData, viewport: { x: 30, y: 40, zoom: 1.5 } },
    }), { params: { id: "11" } });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "CANVAS_CONFLICT",
      serverRevision: 8,
      serverData,
    });
  });

  it("marks canvas image and video generations with an isolated canvas source", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    const imageRoute = read("app/api/canvas/generate/route.ts");
    const videoRoute = read("app/api/canvas/generate-video/route.ts");
    const imageService = read("lib/generation/image-service.ts");
    const videoService = read("lib/generation/video-service.ts");

    expect(imageRoute).toContain('source: "canvas"');
    expect(videoRoute).toContain('source: "canvas"');
    expect(imageService).toContain('"tool" | "agent" | "canvas"');
    expect(videoService).toContain('"tool" | "agent" | "canvas"');
  });
});
