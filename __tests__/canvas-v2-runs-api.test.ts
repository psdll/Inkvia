import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  requireCanvasEntryEnabled: vi.fn(),
  canvasFindFirst: vi.fn(),
  runFindMany: vi.fn(),
  runFindFirst: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  createQueuedRun: vi.fn(),
  cancelRun: vi.fn(),
  getRunDetail: vi.fn(),
  appSettingFindUnique: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/canvas/run-queue", () => ({
  CanvasRunQueueError: class CanvasRunQueueError extends Error {},
  createQueuedCanvasRun: mocks.createQueuedRun,
  cancelCanvasRun: mocks.cancelRun,
  getCanvasRunDetail: mocks.getRunDetail,
}));
vi.mock("@/lib/prisma", () => ({ default: { canvas: { findFirst: mocks.canvasFindFirst }, canvasRun: { findMany: mocks.runFindMany, findFirst: mocks.runFindFirst, create: mocks.runCreate, update: mocks.runUpdate }, appSetting: { findUnique: mocks.appSettingFindUnique } } }));

function request(url: string, method = "GET", body?: unknown, sessionId?: string) {
  return new Request(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json", ...(sessionId ? { "X-Canvas-Session-Id": sessionId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }) as any;
}

describe("canvas v2 run APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.canvasFindFirst.mockResolvedValue({ id: 11, revision: 4 });
    mocks.runCreate.mockResolvedValue({ id: 31, status: "running", graphRevision: 4, state: {}, startedAt: new Date() });
    mocks.createQueuedRun.mockResolvedValue({ id: 31, status: "queued", graphRevision64: "4", requestKey: "d31782e3-d0fb-4aa1-9096-a7d16878cd55", stepCount: 2 });
    mocks.cancelRun.mockResolvedValue({ id: 31, status: "cancelled", idempotent: false });
    mocks.getRunDetail.mockResolvedValue({ id: 31, status: "running", graphRevision64: "4", steps: [{ id: "91", nodeId: "a", status: "waiting_provider" }] });
    mocks.appSettingFindUnique.mockResolvedValue({
      value: JSON.stringify({ sessionId: "session-current", expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    });
  });

  it("creates a user-isolated run pinned to the current graph revision", async () => {
    const { POST } = await import("@/app/api/canvas/[id]/runs/route");
    const response = await POST(request("http://localhost/api/canvas/11/runs", "POST", { scope: "downstream", nodeIds: ["a", "b"], expectedRevision: "4" }, "session-current"), { params: { id: "11" } });
    expect(response.status).toBe(200);
    expect(mocks.canvasFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 11, deletedAt: null }) }));
    expect(mocks.createQueuedRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ authUserId: 7, canvasId: 11, scope: "downstream", nodeIds: ["a", "b"], expectedRevision: "4" }));
  });

  it("rejects a missing or malformed expected revision before queueing billable work", async () => {
    const { POST } = await import("@/app/api/canvas/[id]/runs/route");
    const response = await POST(request("http://localhost/api/canvas/11/runs", "POST", { scope: "full" }, "session-current"), { params: { id: "11" } });

    expect(response.status).toBe(400);
    expect(mocks.createQueuedRun).not.toHaveBeenCalled();
  });

  it("rejects a run before queueing when the editor session token is missing", async () => {
    const { POST } = await import("@/app/api/canvas/[id]/runs/route");

    const response = await POST(request("http://localhost/api/canvas/11/runs", "POST", { scope: "full", expectedRevision: "4" }), { params: { id: "11" } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "CANVAS_SESSION_EXPIRED" });
    expect(mocks.createQueuedRun).not.toHaveBeenCalled();
  });

  it("allows the owner to request cancellation but not forge worker state", async () => {
    const { PATCH } = await import("@/app/api/canvas/runs/[runId]/route");
    const response = await PATCH(request("http://localhost/api/canvas/runs/31", "PATCH", { action: "cancel" }), { params: { runId: "31" } });
    expect(response.status).toBe(200);
    expect(mocks.cancelRun).toHaveBeenCalledWith(expect.anything(), { runId: 31, authUserId: 7 });

    const forged = await PATCH(request("http://localhost/api/canvas/runs/31", "PATCH", { status: "success", state: {} }), { params: { runId: "31" } });
    expect(forged.status).toBe(400);
  });

  it("returns server-owned step progress for polling", async () => {
    const { GET } = await import("@/app/api/canvas/runs/[runId]/route");
    const response = await GET(request("http://localhost/api/canvas/runs/31"), { params: { runId: "31" } });
    expect(response.status).toBe(200);
    expect(mocks.getRunDetail).toHaveBeenCalledWith(expect.anything(), { runId: 31, authUserId: 7 });
  });
});
