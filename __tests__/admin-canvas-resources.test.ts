import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), history: vi.fn(), detail: vi.fn(), library: vi.fn(), file: vi.fn(), folder: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: mocks.auth }));
vi.mock("@/lib/assets/canvas-history-server", () => ({ getCanvasAssetHistory: mocks.history, getCanvasAssetDetail: mocks.detail }));
vi.mock("@/lib/canvas/personal-library", () => ({ getPersonalLibrary: mocks.library, personalFolderDownload: mocks.folder }));
vi.mock("@/lib/canvas/personal-material-response", () => ({ readPersonalMaterialResponse: mocks.file }));
import { GET } from "@/app/api/admin/user/canvas-resources/route";
const request = (resource: string, adminKey = "auth:30") => new NextRequest(`http://localhost/api/admin/user/canvas-resources?${new URLSearchParams({ resource, adminKey })}`);
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ ok: true }); });
describe("administrator canvas resources", () => {
  it("rejects unauthenticated requests before reading private resources", async () => {
    mocks.auth.mockReturnValue({ ok: false, error: "UNAUTHORIZED" });
    expect((await GET(request("/api/canvas/materials"))).status).toBe(401);
    expect(mocks.library).not.toHaveBeenCalled();
  });
  it("restricts history to the selected registered account", async () => {
    mocks.history.mockResolvedValue(NextResponse.json({ items: [] }));
    await GET(request("/api/assets?canvasId=7"));
    expect(mocks.history).toHaveBeenCalledWith(expect.any(NextRequest), 30);
    expect((await GET(request("/api/assets", "guest:30"))).status).toBe(400);
  });
  it("reads catalogs and files without initialization or user library locks", async () => {
    mocks.library.mockResolvedValue({ version: 1, folders: [], items: [] });
    expect((await GET(request("/api/canvas/materials"))).headers.get("cache-control")).toContain("no-store");
    expect(mocks.library).toHaveBeenCalledWith(30, true);
    mocks.file.mockResolvedValue(new NextResponse(null));
    await GET(request("/api/canvas/materials/a/file?preview=120&owner=999"));
    expect(mocks.file).toHaveBeenCalledWith(expect.any(NextRequest), 30, "a", true);
    expect(mocks.file.mock.calls[0][0].nextUrl.searchParams.get("owner")).toBe("30");
  });
  it.each(["https://example.com/api/assets", "/api/canvas/7/runs", "/api/canvas/materials/a/use", "/api/admin/users"])("rejects non-view resources: %s", async resource => {
    expect((await GET(request(resource))).status).toBeGreaterThanOrEqual(400);
    expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.file).not.toHaveBeenCalled();
  });
});
