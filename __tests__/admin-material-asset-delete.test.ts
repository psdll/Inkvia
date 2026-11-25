import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  deleteStoredMediaRefs: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true, username: "admin" }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    materialAsset: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/media-cleanup", () => ({
  deleteStoredMediaRefs: mocks.deleteStoredMediaRefs,
}));

vi.mock("@/lib/material-asset-media", () => ({
  materialAssetAllMediaRefs: (row: { imageUrl: string }) => [row.imageUrl],
}));

import { DELETE } from "@/app/api/admin/material-assets/route";

describe("admin material asset deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([{ id: 12, imageUrl: "/uploads/material.jpg" }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("reports a completed logical deletion even when physical cleanup needs retrying", async () => {
    mocks.deleteStoredMediaRefs.mockRejectedValue(new Error("storage cleanup unavailable"));

    const response = await DELETE(new Request("http://localhost/api/admin/material-assets", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [12] }),
    }) as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      count: 1,
      cleanupWarning: "storage cleanup unavailable",
    });
  });
});
