import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUserId: vi.fn(), requireCanvasEntryEnabled: vi.fn(), projectFindMany: vi.fn(), projectFindFirst: vi.fn(), projectCreate: vi.fn(), canvasFindFirst: vi.fn(), canvasUpdate: vi.fn(), appSettingFindUnique: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/prisma", () => ({ default: { canvasProject: { findMany: mocks.projectFindMany, findFirst: mocks.projectFindFirst, create: mocks.projectCreate }, canvas: { findFirst: mocks.canvasFindFirst, update: mocks.canvasUpdate }, appSetting: { findUnique: mocks.appSettingFindUnique } } }));

function request(url: string, method = "GET", body?: unknown, sessionId?: string) { return new Request(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json", ...(sessionId ? { "X-Canvas-Session-Id": sessionId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }) as any; }

describe("canvas v2 project APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.appSettingFindUnique.mockResolvedValue({
      value: JSON.stringify({ sessionId: "session-current", expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    });
  });

  it("creates a project owned by the authenticated user", async () => {
    mocks.projectCreate.mockResolvedValue({ id: 3, name: "Campaign", sortOrder: 0 });
    const { POST } = await import("@/app/api/canvas/projects/route");
    const response = await POST(request("http://localhost/api/canvas/projects", "POST", { name: "Campaign" }));
    expect(response.status).toBe(200);
    expect(mocks.projectCreate).toHaveBeenCalledWith(expect.objectContaining({ data: { authUserId: 7, name: "Campaign", sortOrder: 0 } }));
  });

  it("moves a canvas only to a project owned by the same user", async () => {
    mocks.canvasFindFirst.mockResolvedValue({ id: 11 });
    mocks.projectFindFirst.mockResolvedValue({ id: 3 });
    mocks.canvasUpdate.mockResolvedValue({ id: 11, projectId: 3, sortOrder: 2 });
    const { PATCH } = await import("@/app/api/canvas/[id]/metadata/route");
    const response = await PATCH(request("http://localhost/api/canvas/11/metadata", "PATCH", { projectId: 3, sortOrder: 2 }), { params: { id: "11" } });
    expect(response.status).toBe(200);
    expect(mocks.projectFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3, authUserId: 7, deletedAt: null } }));
    expect(mocks.canvasUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { projectId: 3, sortOrder: 2 } }));
  });

  it("rejects metadata writes that omit the editor session token", async () => {
    mocks.canvasFindFirst.mockResolvedValue({ id: 11 });
    const { PATCH } = await import("@/app/api/canvas/[id]/metadata/route");

    const response = await PATCH(request("http://localhost/api/canvas/11/metadata", "PATCH", { title: "Blocked" }), { params: { id: "11" } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ success: false, code: "CANVAS_SESSION_EXPIRED" });
    expect(mocks.canvasUpdate).not.toHaveBeenCalled();
  });

  it("updates owner-only project-list title and cover without an editor session", async () => {
    mocks.canvasFindFirst.mockResolvedValue({ id: 11 });
    mocks.canvasUpdate.mockResolvedValue({ id: 11, title: "Renamed", thumbnail: "/cover.png" });
    const { PATCH } = await import("@/app/api/canvas/[id]/project-metadata/route");

    const response = await PATCH(request("http://localhost/api/canvas/11/project-metadata", "PATCH", { title: " Renamed ", thumbnail: " /cover.png " }), { params: { id: "11" } });

    expect(response.status).toBe(200);
    expect(mocks.canvasFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11, authUserId: 7, deletedAt: null } }));
    expect(mocks.canvasUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { title: "Renamed", thumbnail: "/cover.png" } }));
  });
});
