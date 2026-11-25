import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  deleteStoredMediaRefs: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true, username: "admin" }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    mediaLibraryItem: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/media-cleanup", () => ({
  deleteStoredMediaRefs: mocks.deleteStoredMediaRefs,
}));

vi.mock("@/lib/logger", () => ({
  Logger: { log: mocks.log },
}));

import { POST } from "@/app/api/admin/media-library/delete/route";

describe("admin shared product-library deletion safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([
      {
        id: 12,
        title: "历史任务参考图",
        fileUrl: "/uploads/products/shared/image/keep.png",
        thumbnailUrl: "/uploads/products/previews/generated/keep.webp",
      },
    ]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteStoredMediaRefs.mockResolvedValue({
      deletedLocalFiles: 0,
      skippedProtectedRefsCount: 1,
    });
    mocks.log.mockResolvedValue(undefined);
  });

  it("soft-deletes the library row and delegates files to reference-aware cleanup", async () => {
    const response = await POST(new Request("http://localhost/api/admin/media-library/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "ids", ids: [12] }),
    }) as any);

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [12] } },
      data: { isDeleted: true },
    });
    expect(mocks.deleteStoredMediaRefs).toHaveBeenCalledWith(
      [
        "/uploads/products/shared/image/keep.png",
        "/uploads/products/previews/generated/keep.webp",
      ],
      {
        allowMaterialDeletion: true,
        excludeMediaLibraryItemIds: [12],
      },
    );
  });
});
