import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encodeAdminWorksCursor } from "@/lib/admin-user-works-cursor";

const mocks = vi.hoisted(() => ({
  getAdminUserWorkIds: vi.fn(),
  getAdminUserWorks: vi.fn(),
  getAdminUserFailedWorkIds: vi.fn(),
  getAdminUserWorksChanges: vi.fn(),
  resolveAdminUserScope: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true }),
}));

vi.mock("@/lib/admin-user-scope", () => ({
  resolveAdminUserScope: mocks.resolveAdminUserScope,
}));

vi.mock("@/lib/admin-user-works", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-user-works")>();
  return {
    ...actual,
    getAdminUserWorkIds: mocks.getAdminUserWorkIds,
    getAdminUserWorks: mocks.getAdminUserWorks,
    getAdminUserFailedWorkIds: mocks.getAdminUserFailedWorkIds,
    getAdminUserWorksChanges: mocks.getAdminUserWorksChanges,
  };
});

import { GET as getWorks } from "@/app/api/admin/user/works/route";
import { GET as getWorksChanges } from "@/app/api/admin/user/works/changes/route";

const scope = {
  requestedUserId: "123",
  authUserId: 123,
  linkedUserIds: ["device-a"],
  generationWhere: { authUserId: 123 },
  logWhere: { userId: "device-a" },
};

describe("admin user works routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAdminUserScope.mockResolvedValue(scope);
    mocks.getAdminUserWorks.mockResolvedValue({
      generations: [],
      pagination: { pageSize: 40, nextCursor: null, hasMore: false, total: null },
      syncCursor: { updatedAt: "2026-07-16T00:00:00.000Z", id: 1 },
      serverTime: "2026-07-16T00:00:00.000Z",
    });
    mocks.getAdminUserFailedWorkIds.mockResolvedValue([31, 7]);
  });

  it("bounds card pages even when a caller asks for all records", async () => {
    await getWorks(new NextRequest("http://localhost/api/admin/user/works?adminKey=auth%3A123&view=cards&limit=10000&all=1"));
    expect(mocks.getAdminUserWorks).toHaveBeenCalledWith(expect.objectContaining({cardsOnly:true,pageSize:60,all:false}));
  });
  it("passes server date filters and rejects invalid dates", async () => {
    await getWorks(new NextRequest("http://localhost/api/admin/user/works?adminKey=auth%3A123&from=2026-09-01T00:00:00Z&to=2026-09-28T23:59:59Z"));
    expect(mocks.getAdminUserWorks).toHaveBeenCalledWith(expect.objectContaining({from:new Date('2026-09-01T00:00:00Z'),to:new Date('2026-09-28T23:59:59Z')}));
    mocks.getAdminUserWorks.mockClear();
    const invalid=await getWorks(new NextRequest("http://localhost/api/admin/user/works?adminKey=auth%3A123&from=invalid"));
    expect(invalid.status).toBe(400); expect(mocks.getAdminUserWorks).not.toHaveBeenCalled();
  });
  it("returns only failed IDs for the full-user selection shortcut", async () => {
    const response = await getWorks(
      new NextRequest("http://localhost/api/admin/user/works?adminKey=auth%3A123&failedIdsOnly=1"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ scopeKey: "auth:123", failedIds: [31, 7] }));
    expect(mocks.getAdminUserFailedWorkIds).toHaveBeenCalledWith(scope);
    expect(mocks.getAdminUserWorks).not.toHaveBeenCalled();
  });

  it("accepts an explicit auth adminKey and returns the same scopeKey", async () => {
    const response = await getWorks(new NextRequest("http://localhost/api/admin/user/works?adminKey=auth%3A123&limit=40&source=canvas"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.resolveAdminUserScope).toHaveBeenCalledWith("123", 123, { explicitIdentity: true });
    expect(mocks.getAdminUserWorks).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 40, sourceFilter: "canvas" }));
    expect(body.scopeKey).toBe("auth:123");
  });

  it("passes the selected source to incremental changes", async () => {
    mocks.getAdminUserWorksChanges.mockResolvedValue({
      generations: [],
      deletedIds: [],
      nextCursor: { updatedAt: "2026-07-16T00:00:00.000Z", id: 0 },
      hasMore: false,
    });
    const response = await getWorksChanges(
      new NextRequest(
        "http://localhost/api/admin/user/works/changes?adminKey=auth%3A123&sinceUpdatedAt=2026-07-16T00%3A00%3A00.000Z&sinceId=0&source=batch",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getAdminUserWorksChanges).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFilter: "batch" }),
    );
  });

  it("returns 400 and does not query changes when either sync cursor field is missing", async () => {
    const missingBoth = await getWorksChanges(
      new NextRequest("http://localhost/api/admin/user/works/changes?adminKey=auth%3A123"),
    );
    const missingId = await getWorksChanges(
      new NextRequest(
        "http://localhost/api/admin/user/works/changes?adminKey=auth%3A123&sinceUpdatedAt=2026-07-16T00%3A00%3A00.000Z",
      ),
    );

    expect(missingBoth.status).toBe(400);
    expect(missingId.status).toBe(400);
    expect(mocks.getAdminUserWorksChanges).not.toHaveBeenCalled();
  });

  it("accepts id zero for an empty first-page sync cursor", async () => {
    mocks.getAdminUserWorksChanges.mockResolvedValue({
      generations: [],
      deletedIds: [],
      nextCursor: { updatedAt: "2026-07-16T00:00:00.000Z", id: 0 },
      hasMore: false,
    });
    const response = await getWorksChanges(
      new NextRequest(
        "http://localhost/api/admin/user/works/changes?adminKey=auth%3A123&sinceUpdatedAt=2026-07-16T00%3A00%3A00.000Z&sinceId=0",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getAdminUserWorksChanges).toHaveBeenCalledWith(expect.objectContaining({ sinceId: 0 }));
  });

  it("passes the read-model event cursor to incremental changes", async () => {
    mocks.getAdminUserWorksChanges.mockResolvedValue({
      generations: [],
      deletedIds: [],
      nextCursor: { updatedAt: "2026-07-16T00:00:00.000Z", id: 0, sourceEventId: 12 },
      hasMore: false,
    });
    const response = await getWorksChanges(
      new NextRequest(
        "http://localhost/api/admin/user/works/changes?adminKey=auth%3A123&sinceUpdatedAt=2026-07-16T00%3A00%3A00.000Z&sinceId=0&sinceSourceEventId=11",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getAdminUserWorksChanges).toHaveBeenCalledWith(
      expect.objectContaining({ sinceId: 0, sinceSourceEventId: 11 }),
    );
  });

  it("decodes the opaque page cursor and rejects malformed cursors", async () => {
    const createdAt = new Date("2026-07-15T00:00:00.000Z");
    const encoded = encodeAdminWorksCursor({ createdAt, id: 42 });

    const valid = await getWorks(
      new NextRequest(`http://localhost/api/admin/user/works?adminKey=auth%3A123&cursor=${encoded}`),
    );
    expect(valid.status).toBe(200);
    expect(mocks.getAdminUserWorks).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { createdAt, id: 42 } }),
    );

    mocks.getAdminUserWorks.mockClear();
    const invalid = await getWorks(
      new NextRequest("http://localhost/api/admin/user/works?adminKey=auth%3A123&cursor=broken"),
    );
    expect(invalid.status).toBe(400);
    expect(mocks.getAdminUserWorks).not.toHaveBeenCalled();
  });
});

 it("returns all filtered IDs without loading card details", async () => {
  vi.clearAllMocks();
  mocks.resolveAdminUserScope.mockResolvedValue(scope);
  mocks.getAdminUserWorkIds.mockResolvedValue([1, 2, 3]);
  const response = await getWorks(new NextRequest("http://localhost/api/admin/user/works?adminKey=auth%3A123&idsOnly=1&typeFilter=import&from=2026-09-01T00:00:00Z"));
  expect(await response.json()).toEqual({ scopeKey: "auth:123", ids: [1, 2, 3] });
  expect(mocks.getAdminUserWorkIds).toHaveBeenCalledWith({ scope, kind: "generated", typeFilter: "import", sourceFilter: "creation", from: new Date("2026-09-01T00:00:00Z"), to: null });
  expect(mocks.getAdminUserWorks).not.toHaveBeenCalled();
});
