import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MEDIA_LIBRARY_UNGROUPED } from "@/lib/media-library";
import { planProductFolderChange, productFolders } from "@/lib/media-library-folders";

const state = vi.hoisted(() => ({ user: 7 as number | null, settings: {} as Record<string, string>, rows: [] as any[], writes: [] as any[] }));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async () => state.user ? { id: state.user, username: "tester" } : null }));
vi.mock("@/lib/prisma", () => {
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: any) => {
    if (value && typeof value === "object") return "in" in value ? value.in.includes(row[key]) : "not" in value ? row[key] !== value.not : false;
    return row[key] === value;
  });
  const db: any = {
    appSetting: {
      findUnique: async ({ where }: any) => state.settings[where.key] === undefined ? null : { value: state.settings[where.key] },
      upsert: async ({ where, create }: any) => { state.settings[where.key] ??= create.value; },
      update: async ({ where, data }: any) => { state.settings[where.key] = data.value; },
    },
    mediaLibraryItem: {
      findMany: async ({ where }: any) => state.rows.filter(row => matches(row, where)),
      count: async ({ where }: any) => state.rows.filter(row => matches(row, where)).length,
      updateMany: async ({ where, data }: any) => {
        state.writes.push({ where, data });
        state.rows.filter(row => matches(row, where)).forEach(row => Object.assign(row, data));
      },
      create: async ({ data }: any) => { const row = { ...data, id: 100 + state.rows.length, createdAt: new Date() }; state.rows.push(row); return row; },
    },
    $transaction: async (work: any) => {
      const before = structuredClone({ settings: state.settings, rows: state.rows });
      try { return await work(db); } catch (error) { state.settings = before.settings; state.rows = before.rows; throw error; }
    },
  };
  return { default: db };
});
vi.mock("@/lib/storage", () => ({ saveBufferFile: vi.fn(async (_buffer, folder) => `/uploads/${folder}/2026-09-20/new.png`) }));
vi.mock("@/lib/upload-validation", () => ({ validateUploadFile: async () => ({ ok: true, kind: "image" }) }));
vi.mock("@/lib/media-library-thumbnails", () => ({ createMediaLibraryImagePreview: async () => null, createMediaLibraryVideoPoster: async () => null }));
vi.mock("@/lib/media-cleanup", () => ({ deleteStoredMediaRefs: vi.fn(async () => ({})) }));
vi.mock("@/lib/upload-limits", () => ({ UploadLimitError: class extends Error {}, assertRequestContentLengthUnderLimit: () => {}, assertUploadBatchWithinLimits: () => {}, assertUploadDiskWatermark: async () => {} }));
import { getProductFolders, changeProductFolders } from "@/lib/media-library-folders-server";
import { GET, POST } from "@/app/api/media-library/folders/route";
import { POST as upload } from "@/app/api/media-library/upload/route";
import { saveBufferFile } from "@/lib/storage";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";

beforeEach(() => {
  state.user = 7; state.settings = {}; state.writes = [];
  state.rows = [
    { id: 1, ownerUserId: 7, scope: "private", isDeleted: false, groupName: null, fileUrl: "/uploads/products/private/user_tester/image/old.png" },
    { id: 2, ownerUserId: 7, scope: "private", isDeleted: false, groupName: "旧分组", fileUrl: "/uploads/products/private/user_tester/image/legacy.png" },
    { id: 3, ownerUserId: 8, scope: "private", isDeleted: false, groupName: "其他人", fileUrl: "/other.png" },
    { id: 4, ownerUserId: null, scope: "shared", isDeleted: false, groupName: "共享", fileUrl: "/shared.png" },
  ];
  vi.mocked(saveBufferFile).mockClear(); vi.mocked(deleteStoredMediaRefs).mockClear();
});

describe("product library directory compatibility", () => {
  it("reads legacy groups without rewriting data and scopes them to their owner", async () => {
    expect(await getProductFolders(7)).toEqual([{ id: "旧分组", name: "旧分组", parentId: null }]);
    expect(state.settings).toEqual({}); expect(state.writes).toEqual([]);
    expect(state.rows[0].groupName).toBeNull();
  });
  it("keeps empty nested folders and moves items without changing IDs or URLs", async () => {
    await changeProductFolders(7, { operation: "create", name: "产品" });
    await changeProductFolders(7, { operation: "create", name: "S790", parentId: "产品" });
    const before = state.rows[1].fileUrl;
    await changeProductFolders(7, { operation: "moveItems", itemIds: [2], parentId: "产品/S790" });
    expect(state.rows[1]).toMatchObject({ id: 2, groupName: "产品/S790", fileUrl: before });
    expect((await getProductFolders(7)).some(folder => folder.id === "旧分组")).toBe(true);
    await changeProductFolders(7, { operation: "moveItems", itemIds: [2], parentId: MEDIA_LIBRARY_UNGROUPED });
    expect(state.rows[1].groupName).toBeNull();
    expect((await getProductFolders(7)).some(folder => folder.id === "产品/S790")).toBe(true);
  });
  it("renames descendants together, then deletes only that subtree", async () => {
    await changeProductFolders(7, { operation: "create", name: "详情", parentId: "旧分组" });
    await changeProductFolders(7, { operation: "moveItems", itemIds: [1], parentId: "旧分组/详情" });
    await changeProductFolders(7, { operation: "rename", id: "旧分组", name: "按摩椅" });
    expect(state.rows[0].groupName).toBe("按摩椅/详情"); expect(state.rows[1].groupName).toBe("按摩椅");
    await changeProductFolders(7, { operation: "create", name: "产品" });
    await expect(changeProductFolders(7, { operation: "move", id: "按摩椅", parentId: "产品" })).rejects.toThrow("文件夹不能移动");
    expect(state.rows[0].groupName).toBe("按摩椅/详情");
    await changeProductFolders(7, { operation: "delete", id: "按摩椅" });
    expect(state.rows.slice(0, 2).every(row => row.isDeleted)).toBe(true);
    expect(state.rows.slice(2).every(row => !row.isDeleted)).toBe(true);
    expect(state.rows[0].fileUrl).toContain("old.png");
    expect((await getProductFolders(7)).map(folder => folder.id)).toEqual(["产品"]);
  });
  it("rejects cross-user and shared-item mutations atomically", async () => {
    for (const operation of ["moveItems", "deleteItems"] as const) {
      await expect(changeProductFolders(7, { operation, itemIds: [1, 3], parentId: MEDIA_LIBRARY_UNGROUPED })).rejects.toThrow("无权操作");
      await expect(changeProductFolders(7, { operation, itemIds: [4], parentId: MEDIA_LIBRARY_UNGROUPED })).rejects.toThrow("无权操作");
    }
    expect(state.rows.every(row => !row.isDeleted)).toBe(true); expect(state.writes).toEqual([]);
  });
  it("preserves the empty directory after deleting its last item", async () => {
    await changeProductFolders(7, { operation: "deleteItems", itemIds: [2] });
    expect((await getProductFolders(7)).map(folder => folder.id)).toEqual(["旧分组"]);
  });
  it("rejects cycles, duplicate names, invalid names and overlong paths", () => {
    const folders = productFolders(["产品/S790", "场景"]);
    expect(() => planProductFolderChange(folders, { operation: "move", id: "产品", parentId: "产品/S790" })).toThrow("子文件夹");
    expect(() => planProductFolderChange(folders, { operation: "rename", id: "产品", name: "场景" })).toThrow("同名");
    expect(() => planProductFolderChange(folders, { operation: "create", name: "../bad" })).toThrow("名称");
    expect(() => planProductFolderChange(folders, { operation: "create", name: "x".repeat(81) })).toThrow("80");
  });
  it("requires authentication and does not accept client-supplied ownership", async () => {
    state.user = null;
    expect((await GET(new NextRequest("http://localhost/api/media-library/folders"))).status).toBe(401);
    expect((await POST(new NextRequest("http://localhost/api/media-library/folders", { method: "POST", body: "{}" }))).status).toBe(401);
    state.user = 7;
    const result = await POST(new NextRequest("http://localhost/api/media-library/folders", { method: "POST", body: JSON.stringify({ operation: "deleteItems", itemIds: [3], ownerUserId: 8 }) }));
    expect(result.status).toBe(400); expect(state.rows[2].isDeleted).toBe(false);
  });
  async function sendUpload(folderId?: string, groupName?: string) {
    const form = new FormData(); form.set("scope", "private"); form.set("file", new File(["image"], "test.png", { type: "image/png" }));
    if (folderId !== undefined) form.set("folderId", folderId);
    if (groupName) form.set("groupName", groupName);
    // Preserve File identity across the Node/Next multipart adapters in this unit test.
    return upload({ headers: new Headers(), formData: async () => form } as NextRequest);
  }
  it("keeps both old unclassified/group uploads and new folder uploads under private", async () => {
    expect((await sendUpload()).status).toBe(200);
    expect(state.rows.at(-1).groupName).toBeNull();
    expect((await sendUpload(undefined, "旧客户端")).status).toBe(200);
    expect(state.rows.at(-1).groupName).toBe("旧客户端");
    await changeProductFolders(7, { operation: "create", name: "产品" });
    expect((await sendUpload("产品")).status).toBe(200);
    expect(state.rows.at(-1)).toMatchObject({ groupName: "产品", ownerUserId: 7, scope: "private" });
    expect(state.rows.at(-1).fileUrl).toContain("/uploads/products/private/user_tester/image/");
    expect((await sendUpload(MEDIA_LIBRARY_UNGROUPED)).status).toBe(200);
    expect(state.rows.at(-1).groupName).toBeNull();
  });
  it("rejects missing folders before saving and cleans a failed upload if the destination disappears", async () => {
    expect((await sendUpload("不存在")).status).not.toBe(200);
    expect(saveBufferFile).not.toHaveBeenCalled();
    vi.mocked(saveBufferFile).mockImplementationOnce(async () => {
      state.rows[1].isDeleted = true;
      return "/uploads/products/private/user_tester/image/new.png";
    });
    expect((await sendUpload("旧分组")).status).not.toBe(200);
    expect(deleteStoredMediaRefs).toHaveBeenCalled();
    expect(state.rows).toHaveLength(4);
  });
});
