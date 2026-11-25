import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathExists: vi.fn(),
  readFile: vi.fn(),
  saveBufferFile: vi.fn(),
  saveRemoteFile: vi.fn(),
}));

vi.mock("fs-extra", () => ({
  default: {
    pathExists: mocks.pathExists,
    readFile: mocks.readFile,
  },
}));

vi.mock("@/lib/public-path", () => ({
  resolvePublicPath: (value: string) => `C:/public/${value}`,
}));

vi.mock("@/lib/storage", () => ({
  saveBufferFile: mocks.saveBufferFile,
  saveRemoteFile: mocks.saveRemoteFile,
}));

import {
  copyUploadPathToImports,
  snapshotLibraryInputs,
} from "@/lib/generation/input-snapshot";

describe("generation library input snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExists.mockResolvedValue(true);
    mocks.readFile.mockResolvedValue(Buffer.from("source"));
    mocks.saveBufferFile.mockResolvedValue("/uploads/imports/2026-08-17/local.png");
    mocks.saveRemoteFile.mockResolvedValue("/uploads/imports/2026-08-17/remote.png");
  });

  it("downloads a remote shared product-library input into an independent task snapshot", async () => {
    const source = "https://cdn.example.com/uploads/products/shared/image/source.png";

    await expect(snapshotLibraryInputs([source])).resolves.toEqual([
      "/uploads/imports/2026-08-17/remote.png",
    ]);
    expect(mocks.saveRemoteFile).toHaveBeenCalledWith(source, "imports");
  });

  it("rejects a missing local library source instead of retaining a fragile original path", async () => {
    mocks.pathExists.mockResolvedValue(false);

    await expect(
      copyUploadPathToImports("/uploads/products/shared/image/missing.png"),
    ).rejects.toThrow("源素材不存在");
    expect(mocks.saveBufferFile).not.toHaveBeenCalled();
  });

  it("snapshots the legacy product-library path used by older tasks", async () => {
    const source = "/uploads/product-library/legacy.png";

    await expect(snapshotLibraryInputs([source])).resolves.toEqual([
      "/uploads/imports/2026-08-17/local.png",
    ]);
    expect(mocks.saveBufferFile).toHaveBeenCalled();
  });
});
