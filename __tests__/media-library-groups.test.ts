import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ user: 7 as number | null, rows: [] as any[] }));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async () => state.user ? { id: state.user } : null }));
vi.mock("@/lib/admin-auth", () => ({ isAdminRequest: () => false }));
vi.mock("@/lib/prisma", () => ({ default: { mediaLibraryItem: { findMany: async ({ where }: any) => {
  const matches = (row: any, condition: any): boolean => Object.entries(condition).every(([key, value]: any) =>
    key === "AND" ? value.every((part: any) => matches(row, part)) : key === "OR" ? value.some((part: any) => matches(row, part)) : row[key] === value);
  return state.rows.filter(row => matches(row, where)).map(({ groupName }) => ({ groupName }));
} } } }));
import { GET } from "@/app/api/media-library/groups/route";
const get = async (query: string) => (await GET(new NextRequest(`http://localhost/api/media-library/groups?${query}`))).json();
beforeEach(() => {
  state.user = 7;
  state.rows = [
    { scope: "shared", kind: "image", groupName: "共享图片", isDeleted: false },
    { scope: "shared", kind: "image", groupName: "已删除", isDeleted: true },
    { scope: "shared", kind: "video", groupName: null, isDeleted: false },
    { scope: "private", ownerUserId: 7, kind: "image", groupName: "我的图片", isDeleted: false },
    { scope: "private", ownerUserId: 7, kind: "image", groupName: "", isDeleted: false },
    { scope: "private", ownerUserId: 8, kind: "image", groupName: "他人图片", isDeleted: false },
  ];
});
it("reports only populated categories and unclassified availability in the selected scope and kind", async () => {
  expect(await get("scope=shared&kind=image")).toMatchObject({ groups: ["共享图片"], hasUngrouped: false });
  expect(await get("scope=shared&kind=video")).toMatchObject({ groups: [], hasUngrouped: true });
  expect(await get("scope=private&kind=image")).toMatchObject({ groups: ["我的图片"], hasUngrouped: true });
  state.rows = [];
  expect(await get("scope=private")).toMatchObject({ groups: [], hasUngrouped: false });
});
it("keeps private categories unavailable to anonymous visitors", async () => {
  state.user = null;
  expect((await GET(new NextRequest("http://localhost/api/media-library/groups?scope=private"))).status).toBe(401);
  expect(await get("scope=shared&kind=image")).toMatchObject({ groups: ["共享图片"], hasUngrouped: false });
});
