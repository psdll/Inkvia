// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import sharp from "sharp";
const state = vi.hoisted(() => ({ root: "", user: 27 as number | null }));
vi.mock("@/lib/public-path", () => ({ resolvePublicPath: (...parts: string[]) => path.join(state.root, ...parts) }));
vi.mock("@/lib/server-auth", () => ({ getUserId: async () => state.user }));
import { getPersonalLibrary, changePersonalLibrary, addPersonalMaterial, withPersonalMaterial, personalFolderDownload } from "@/lib/canvas/personal-library";
import { migrateLegacyCanvasLibrary } from "@/lib/canvas/library-legacy";
import { legacyLibraryFile } from "@/lib/canvas/legacy-library-path";
import { isPrivateUploadPath } from "@/lib/private-upload-path";
import { GET as list, POST as mutate } from "@/app/api/canvas/materials/route";
import { GET as mediaFile } from "@/app/api/canvas/materials/[id]/file/route";
const bytes = Buffer.from("test-media");
const add = (folderId: string | null, user = 27) => addPersonalMaterial(user, folderId, { name: "参考.png", kind: "image", mime: "image/png", size: bytes.length }, bytes, "png");
beforeEach(async () => { state.root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-library-test-")); state.user = 27; });
afterEach(async () => {
  if (path.dirname(state.root) !== os.tmpdir() || !path.basename(state.root).startsWith("personal-library-test-")) throw new Error("unsafe test cleanup");
  await fs.rm(state.root, { recursive: true, force: true });
});
describe("personal library on disk", () => {
  it("lets observers read while a writer holds its lock, without creating or migrating data", async () => {
    expect(await getPersonalLibrary(27, true)).toEqual({ version: 1, folders: [], items: [] });
    expect(await fs.readdir(state.root)).toEqual([]);
    const data = await getPersonalLibrary(27);
    const root = path.join(state.root, "uploads/canvas-library/27");
    const before = await fs.readFile(path.join(root, "_catalog.json"), "utf8");
    await fs.writeFile(path.join(root, "_library.lock"), String(process.pid));
    expect(await getPersonalLibrary(27, true)).toEqual(data);
    expect(await fs.readFile(path.join(root, "_catalog.json"), "utf8")).toBe(before);
    expect(await fs.readFile(path.join(root, "_library.lock"), "utf8")).toBe(String(process.pid));
  });
  it("serves small cached previews behind owner checks without exposing originals", async () => {
    const library = await getPersonalLibrary(27);
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#315b75" } }).png().toBuffer();
    const item = await addPersonalMaterial(27, library.folders[0].id, { name: "large.png", kind: "image", mime: "image/png", size: png.length }, png, "png");
    const request = () => new NextRequest(`http://localhost/api/canvas/materials/${item.id}/file?preview=120&owner=27`);
    const first = await mediaFile(request(), { params: { id: item.id } });
    expect(first.status).toBe(200); expect(first.headers.get("content-type")).toBe("image/webp");
    const output = Buffer.from(await first.arrayBuffer());
    expect((await sharp(output).metadata()).width).toBe(120);
    const second = await mediaFile(request(), { params: { id: item.id } });
    expect(Buffer.from(await second.arrayBuffer())).toEqual(output);
    expect(await fs.readdir(path.join(state.root, "uploads/canvas-library/27/_previews"))).toHaveLength(1);
    state.user = 28;
    expect((await mediaFile(request(), { params: { id: item.id } })).status).toBe(404);
    state.user = null;
    expect((await mediaFile(request(), { params: { id: item.id } })).status).toBe(401);
  });
  it("rejects uploads without an explicit destination folder", async () => {
    const form = new FormData(); form.append("file", new Blob([bytes], { type: "image/png" }), "test.png");
    const response = await mutate(new NextRequest("http://localhost/api/canvas/materials", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("选择或新建上传文件夹");
    expect(await fs.readdir(state.root)).toEqual([]);
  });
  it("initializes seven physical folders once under each user, including concurrent reads", async () => {
    const results = await Promise.all([getPersonalLibrary(27), getPersonalLibrary(27), getPersonalLibrary(28)]);
    expect(results[0]).toEqual(results[1]); expect(results[0].folders).toHaveLength(7);
    expect(results[2].folders[0].id).not.toBe(results[0].folders[0].id);
    for (const f of results[0].folders) expect((await fs.stat(path.join(state.root, "uploads/canvas-library/27", f.name))).isDirectory()).toBe(true);
  });
  it("moves real files, retains IDs through rename, and copies independent nested files", async () => {
    let data = await getPersonalLibrary(27); const product = data.folders[0], scene = data.folders[2];
    const item = await add(product.id);
    const original = await withPersonalMaterial(27, item.id, async (_it, file) => file);
    data = await changePersonalLibrary(27, { operation: "move", type: "item", id: item.id, parentId: scene.id });
    await expect(fs.stat(original)).rejects.toMatchObject({ code: "ENOENT" });
    await changePersonalLibrary(27, { operation: "rename", type: "folder", id: scene.id, name: "场景参考" });
    const moved = await withPersonalMaterial(27, item.id, async (_it, file) => ({ file, bytes: await fs.readFile(file) }));
    expect(moved.file).toContain("场景参考"); expect(moved.bytes).toEqual(bytes);
    data = await changePersonalLibrary(27, { operation: "copy", type: "folder", id: scene.id, parentId: product.id });
    const copy = data.items.find(it => it.id !== item.id)!;
    expect(copy.id).not.toBe(item.id);
    const copiedFile = await withPersonalMaterial(27, copy.id, async (_it, file) => file);
    expect(copiedFile).toContain(path.join("产品", "场景参考 副本"));
    await changePersonalLibrary(27, { operation: "delete", type: "folder", id: scene.id });
    await expect(withPersonalMaterial(27, item.id, async () => null)).rejects.toThrow();
    expect(await fs.readFile(copiedFile)).toEqual(bytes);
    const trash = path.join(state.root, "uploads/canvas-library/27/_trash");
    const recordName = (await fs.readdir(trash)).find(name => name.endsWith(".json"))!;
    const record = JSON.parse(await fs.readFile(path.join(trash, recordName), "utf8"));
    expect(record.moved[0].from).toBe("场景参考");
    expect(await fs.readFile(path.join(path.dirname(trash), record.moved[0].to, item.fileName))).toEqual(bytes);
  });
  it("rejects path traversal, duplicate folders, cyclic moves, and cross-user item/folder access", async () => {
    const data = await getPersonalLibrary(27); const folder = data.folders[0]; const item = await add(folder.id);
    for (const name of ["../outside", "C:\\outside", "_catalog.json", "CON", "folder."]) await expect(changePersonalLibrary(27, { operation: "create", type: "folder", name })).rejects.toThrow();
    await expect(changePersonalLibrary(27, { operation: "create", type: "folder", name: folder.name })).rejects.toThrow("同名");
    const nested = await changePersonalLibrary(27, { operation: "create", type: "folder", name: "子目录", parentId: folder.id });
    const child = nested.folders.find(f => f.parentId === folder.id)!;
    for (const operation of ["move", "copy"] as const) await expect(changePersonalLibrary(27, { operation, type: "folder", id: folder.id, parentId: child.id })).rejects.toThrow("自身");
    await expect(withPersonalMaterial(28, item.id, async () => null)).rejects.toThrow();
    await expect(add(folder.id, 28)).rejects.toThrow();
    await expect(changePersonalLibrary(28, { operation: "delete", type: "folder", id: folder.id })).rejects.toThrow();
  });
  it("keeps root uploads in the new library and downloads nested folders as zip", async () => {
    const data = await getPersonalLibrary(27); const item = await add(null);
    expect((await getPersonalLibrary(27)).items[0].id).toBe(item.id);
    await withPersonalMaterial(27, item.id, async (_it, file) => expect(await fs.readFile(file)).toEqual(bytes));
    await add(data.folders[0].id);
    const result = await personalFolderDownload(27, data.folders[0].id);
    const zip = await JSZip.loadAsync(result.bytes);
    expect(await zip.file("产品/参考.png")!.async("nodebuffer")).toEqual(bytes);
  });
  it("archives old pairs safely, preserves old URLs, and sends workflows to their own directory", async () => {
    const dir = path.join(state.root, "uploads/canvas-library/27"); await fs.mkdir(dir, { recursive: true });
    const imageId = randomUUID(), workflowId = randomUUID();
    for (const [id, ext, kind] of [[imageId, "png", "image"], [workflowId, "canvas.json", "file"]]) {
      await fs.writeFile(path.join(dir, `${id}.${ext}`), bytes);
      await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, kind, url: `/uploads/canvas-library/27/${id}.${ext}` }));
    }
    const result = await migrateLegacyCanvasLibrary(27); expect(result.archived).toBe(4);
    expect((await migrateLegacyCanvasLibrary(27)).archived).toBe(0);
    const resolved = legacyLibraryFile(path.join(state.root, "uploads"), `canvas-library/27/${imageId}.png`)!;
    expect(await fs.readFile(resolved)).toEqual(bytes);
    expect(JSON.parse(await fs.readFile(path.join(state.root, `uploads/canvas-workflows/27/${workflowId}.json`), "utf8")).url).toBe(`/uploads/canvas-workflows/27/${workflowId}.canvas.json`);
  });
  it("enforces authentication, ownership, byte ranges, and blocks public private-path variants", async () => {
    const item = await add(null);
    state.user = null;
    expect((await list(new NextRequest("http://localhost/api/canvas/materials"))).status).toBe(401);
    expect((await mutate(new NextRequest("http://localhost/api/canvas/materials", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await mediaFile(new NextRequest("http://localhost/api/canvas/materials/x/file"), { params: { id: item.id } })).status).toBe(401);
    state.user = 28;
    expect((await mediaFile(new NextRequest("http://localhost/api/canvas/materials/x/file"), { params: { id: item.id } })).status).toBe(404);
    state.user = 27;
    const response = await mediaFile(new NextRequest("http://localhost/api/canvas/materials/x/file", { headers: { range: "bytes=0-3" } }), { params: { id: item.id } });
    expect(response.status).toBe(206); expect(await response.text()).toBe("test");
    for (const relative of ["canvas-library/27/产品/x.png", "CANVAS-LIBRARY/27/x.png", "./canvas-library/27/x.png", "canvas-library. /27/x.png", "canvas-library\\27\\x.png"]) expect(isPrivateUploadPath(relative)).toBe(true);
  });
});
