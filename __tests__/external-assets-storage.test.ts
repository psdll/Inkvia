import { afterEach, describe, expect, it, vi } from "vitest";

const oss = vi.hoisted(() => ({
  isOssReady: vi.fn(async () => false),
  uploadLocalUploadPathToOssWithObjectKey: vi.fn(),
  uploadBufferToOssWithObjectKey: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/oss", () => oss);

import { MissingExternalAssetStorageError, resolveAssetUrlForExternalApi } from "@/lib/external-assets";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("external asset storage", () => {
  it("directs desktop users to configure Aliyun OSS when storage is unavailable", async () => {
    vi.stubEnv("INKVIA_DESKTOP_MODE", "1");
    vi.stubEnv("APP_PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_PUBLIC_BASE_URL", "");
    vi.stubEnv("PUBLIC_BASE_URL", "");
    vi.stubEnv("EXTERNAL_ASSET_URL_STRATEGY", "");
    const delivery = resolveAssetUrlForExternalApi("/uploads/ref.png", "references");
    await expect(delivery).rejects.toBeInstanceOf(MissingExternalAssetStorageError);
    await expect(delivery).rejects.toThrow("请在系统设置里配置阿里云 OSS");
    expect(oss.uploadLocalUploadPathToOssWithObjectKey).not.toHaveBeenCalled();
  });

  it("still uses configured Aliyun OSS on desktop", async () => {
    vi.stubEnv("INKVIA_DESKTOP_MODE", "1");
    vi.stubEnv("APP_PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_PUBLIC_BASE_URL", "");
    vi.stubEnv("PUBLIC_BASE_URL", "");
    vi.stubEnv("EXTERNAL_ASSET_URL_STRATEGY", "");
    oss.isOssReady.mockResolvedValueOnce(true);
    oss.uploadLocalUploadPathToOssWithObjectKey.mockResolvedValueOnce({
      url: "https://oss.example/ref.png", objectKey: "references/ref.png",
    });
    await expect(resolveAssetUrlForExternalApi("/uploads/ref.png", "references")).resolves.toBe("https://oss.example/ref.png");
    expect(oss.uploadLocalUploadPathToOssWithObjectKey).toHaveBeenCalledWith("/uploads/ref.png", "references");
  });
});
