import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  findFirst: vi.fn(),
  parseMaterialAssetMedia: vi.fn(),
  singleResponse: vi.fn(),
  zipResponse: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock("@/lib/prisma", () => ({
  default: { materialAsset: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/material-asset-media", () => ({
  parseMaterialAssetMedia: mocks.parseMaterialAssetMedia,
}));
vi.mock("@/lib/material-asset-download", () => ({
  singleMaterialFileResponse: mocks.singleResponse,
  materialSeriesZipResponse: mocks.zipResponse,
}));

import { GET } from "@/app/api/admin/material-assets/[id]/download/route";

const asset = {
  id: 12,
  title: "净化器素材",
  media: "[]",
  imageUrl: "/uploads/cover.png",
  isDeleted: false,
};
const media = [
  { id: "a", originalUrl: "/uploads/a.png", mime: "image/png" },
  { id: "b", originalUrl: "/uploads/b.jpg", mime: "image/jpeg" },
];

function request(query: string) {
  return new Request(`http://localhost/api/admin/material-assets/12/download${query}`) as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
  mocks.findFirst.mockResolvedValue(asset);
  mocks.parseMaterialAssetMedia.mockReturnValue(media);
  mocks.singleResponse.mockResolvedValue(new Response("single"));
  mocks.zipResponse.mockReturnValue(new Response("zip"));
});

describe("administrator material download", () => {
  it("requires administrator authorization", async () => {
    mocks.requireAdminRequest.mockReturnValue({ ok: false, error: "未登录管理员" });

    const response = await GET(request("?mode=current&mediaId=a"), { params: { id: "12" } });

    expect(response.status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("downloads only a current media item that belongs to the asset", async () => {
    const response = await GET(request("?mode=current&mediaId=b"), { params: { id: "12" } });

    expect(await response.text()).toBe("single");
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 12, isDeleted: false } });
    expect(mocks.singleResponse).toHaveBeenCalledWith("净化器素材", media[1]);
    expect(mocks.zipResponse).not.toHaveBeenCalled();
  });

  it("rejects a current media id outside the asset", async () => {
    const response = await GET(request("?mode=current&mediaId=missing"), { params: { id: "12" } });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "当前素材图片不存在" });
    expect(mocks.singleResponse).not.toHaveBeenCalled();
  });

  it("downloads the ordered series without creating analytics", async () => {
    const response = await GET(request("?mode=series"), { params: { id: "12" } });

    expect(await response.text()).toBe("zip");
    expect(mocks.zipResponse).toHaveBeenCalledWith("净化器素材", media);
    const source = readFileSync(
      resolve(process.cwd(), "app/api/admin/material-assets/[id]/download/route.ts"),
      "utf8",
    );
    expect(source).not.toContain("materialAssetDownload.create");
  });

  it("returns the original directly when series mode targets a single-image material", async () => {
    mocks.parseMaterialAssetMedia.mockReturnValue([media[0]]);

    const response = await GET(request("?mode=series"), { params: { id: "12" } });

    expect(await response.text()).toBe("single");
    expect(mocks.singleResponse).toHaveBeenCalledWith("净化器素材", media[0]);
    expect(mocks.zipResponse).not.toHaveBeenCalled();
  });
});
