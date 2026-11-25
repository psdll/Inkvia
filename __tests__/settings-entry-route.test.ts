import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: 7, username: "creator" } as { id: number; username: string } | null,
  upload: vi.fn(), inspiration: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(),
}));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/prisma", () => ({ default: { materialAsset: mocks } }));
vi.mock("@/lib/material-upload-permission", () => ({ isMaterialUploadAllowed: mocks.upload }));
vi.mock("@/lib/material-creator-permissions", () => ({ isMaterialCreatorInspirationEnabled: mocks.inspiration }));
import { GET } from "@/app/api/settings/entry/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 7, username: "creator" };
  mocks.upload.mockResolvedValue(true);
  mocks.inspiration.mockResolvedValue(true);
  mocks.findFirst.mockResolvedValue({ id: 12 });
});

it("returns only entry flags using an existence lookup, without material lists or totals", async () => {
  const response = await GET(new Request("http://localhost/api/settings/entry") as any);
  expect(await response.json()).toEqual({ canUploadMaterial: true, hasMaterialInspirations: true });
  expect(mocks.findFirst).toHaveBeenCalledWith({ where: { isDeleted: false, creatorName: "creator" }, select: { id: true } });
  expect(mocks.findMany).not.toHaveBeenCalled();
  expect(mocks.count).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it("respects disabled creator permissions without even reading materials", async () => {
  mocks.inspiration.mockResolvedValue(false);
  mocks.upload.mockResolvedValue(false);
  expect(await (await GET(new Request("http://localhost/api/settings/entry") as any)).json()).toEqual({ canUploadMaterial: false, hasMaterialInspirations: false });
  expect(mocks.findFirst).not.toHaveBeenCalled();
});

it("does not expose another account's flags to an unauthenticated request", async () => {
  mocks.user = null;
  expect((await GET(new Request("http://localhost/api/settings/entry") as any)).status).toBe(401);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.findFirst).not.toHaveBeenCalled();
});

it("does not invent an inspiration entry when the creator has no remaining materials", async () => {
  mocks.findFirst.mockResolvedValue(null);
  expect(await (await GET(new Request("http://localhost/api/settings/entry") as any)).json()).toEqual({ canUploadMaterial: true, hasMaterialInspirations: false });
});
