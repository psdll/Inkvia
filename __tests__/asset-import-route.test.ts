import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  saveUploadedFile: vi.fn(),
  saveRemoteFile: vi.fn(),
  copyUploadPathToImports: vi.fn(),
  createGeneration: vi.fn(),
  upsertAdminAssetFeedForGenerationId: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/storage", () => ({
  saveUploadedFile: mocks.saveUploadedFile,
  saveRemoteFile: mocks.saveRemoteFile,
}));
vi.mock("@/lib/generation/input-snapshot", () => ({
  copyUploadPathToImports: mocks.copyUploadPathToImports,
}));
vi.mock("@/lib/prisma", () => ({
  default: { generation: { create: mocks.createGeneration } },
}));
vi.mock("@/lib/admin-asset-feed", () => ({
  upsertAdminAssetFeedForGenerationId: mocks.upsertAdminAssetFeedForGenerationId,
}));

import { POST } from "@/app/api/assets/import/route";

describe("POST /api/assets/import", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.saveUploadedFile.mockResolvedValue("/uploads/imports/2026-07-10/input.png");
    mocks.createGeneration.mockResolvedValue({ id: 42, localPath: "/uploads/imports/2026-07-10/input.png" });
    mocks.upsertAdminAssetFeedForGenerationId.mockResolvedValue(null);
  });

  it("accepts a file-like multipart entry when its File constructor differs from the route runtime", async () => {
    const foreignFile = {
      name: "input.png",
      type: "image/png",
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    };
    const request = {
      formData: vi.fn().mockResolvedValue({
        get: (name: string) => (name === "file" ? foreignFile : null),
      }),
    } as any;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { localPath: "/uploads/imports/2026-07-10/input.png" },
    });
    expect(mocks.saveUploadedFile).toHaveBeenCalledWith(foreignFile, "imports");
  });
});
