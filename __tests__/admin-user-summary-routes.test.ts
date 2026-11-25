import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  listReadModel: vi.fn(),
  getChanges: vi.fn(),
  getLegacy: vi.fn(),
  readModelReady: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: () => ({ ok: true }) }));
vi.mock("@/lib/admin-user-summary-read-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-user-summary-read-model")>();
  return {
    ...actual,
    listAdminUserSummariesFromReadModel: mocks.listReadModel,
    getAdminUserSummaryChanges: mocks.getChanges,
    isAdminSummaryReadModelReady: mocks.readModelReady,
  };
});
vi.mock("@/lib/admin-user-scope", () => ({
  getCachedAdminUserSummaries: mocks.getLegacy,
}));

import { GET as getUsers } from "@/app/api/admin/users/route";
import { GET as getSummaryChanges } from "@/app/api/admin/users/summary-changes/route";

describe("admin user summary routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SUMMARY_READ_MODEL = "1";
    mocks.readModelReady.mockResolvedValue(true);
    mocks.listReadModel.mockResolvedValue({
      items: [{ adminKey: "auth:7" }],
      summaryCursor: "cursor-1",
      nextPageCursor: null,
      hasMore: false,
    });
    mocks.getChanges.mockResolvedValue({
      items: [{ adminKey: "auth:8" }],
      deletedAdminKeys: ["guest:device-a"],
      nextCursor: "cursor-2",
      hasMore: false,
    });
  });

  afterEach(() => delete process.env.ADMIN_SUMMARY_READ_MODEL);

  it("serves the user list from AdminUserSummary with the server cursor", async () => {
    const response = await getUsers(new NextRequest("http://localhost/api/admin/users?limit=200"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listReadModel).toHaveBeenCalledWith({ limit: 200, pageCursor: null, q: "", page: 1 });
    expect(mocks.getLegacy).not.toHaveBeenCalled();
    expect(body).toEqual(expect.objectContaining({ items: [{ adminKey: "auth:7" }], summaryCursor: "cursor-1" }));
  });

  it("keeps the legacy list available until the initial backfill is complete", async () => {
    mocks.readModelReady.mockResolvedValue(false);
    mocks.getLegacy.mockResolvedValue({ items: [{ adminKey: "guest:legacy" }], stale: false });

    const response = await getUsers(new NextRequest("http://localhost/api/admin/users?limit=200"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listReadModel).not.toHaveBeenCalled();
    expect(body.items).toEqual([{ adminKey: "guest:legacy" }]);
  });

  it("passes the opaque cursor and returns the next composite cursor", async () => {
    const response = await getSummaryChanges(
      new NextRequest("http://localhost/api/admin/users/summary-changes?cursor=cursor-1&limit=100"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getChanges).toHaveBeenCalledWith({ cursor: "cursor-1", since: null, limit: 100 });
    expect(body.nextCursor).toBe("cursor-2");
    expect(body.deletedAdminKeys).toEqual(["guest:device-a"]);
  });

  it("keeps the legacy since parameter for one rollout cycle", async () => {
    const response = await getSummaryChanges(
      new NextRequest("http://localhost/api/admin/users/summary-changes?since=2026-07-16T00%3A00%3A00.000Z"),
    );

    expect(response.status).toBe(200);
    expect(mocks.getChanges).toHaveBeenCalledWith({
      cursor: null,
      since: "2026-07-16T00:00:00.000Z",
      limit: 100,
    });
  });
});
