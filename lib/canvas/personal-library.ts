import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolvePublicPath } from "@/lib/public-path";
import { migrateLegacyCanvasLibrary } from "./library-legacy";
import { PERSONAL_LIBRARY_DEFAULTS, personalMaterialDownloadName, type PersonalFolder, type PersonalLibrary, type PersonalMaterial } from "./personal-library-types";

function rootFor(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("无效用户");
  return resolvePublicPath("uploads", "canvas-library", String(userId));
}
function safeName(value: string) {
  const name = value.trim();
  if (!name || name.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name.startsWith(".") || name.startsWith("_") || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) throw new Error("名称无效：不能使用路径符号、保留名称或超过 80 个字");
  return name;
}
export function personalFolderPath(data: PersonalLibrary, folderId: string | null): string {
  const names: string[] = [], seen = new Set<string>();
  while (folderId) {
    if (seen.has(folderId)) throw new Error("文件夹层级循环");
    seen.add(folderId);
    const folder = data.folders.find(f => f.id === folderId);
    if (!folder) throw new Error("文件夹不存在");
    names.unshift(safeName(folder.name)); folderId = folder.parentId;
  }
  return names.join(path.sep);
}
function diskFile(root: string, data: PersonalLibrary, item: PersonalMaterial) {
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/.test(item.fileName)) throw new Error("无效素材文件名");
  return path.join(root, personalFolderPath(data, item.folderId), item.fileName);
}
function availableName(data: PersonalLibrary, parentId: string | null, name: string, except?: string) {
  safeName(name); personalFolderPath(data, parentId);
  if (data.folders.some(f => f.parentId === parentId && f.id !== except && f.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("此位置已有同名文件夹");
}

// Serialize each user's changes across Web processes; never steal a live writer's lock.
async function lock(root: string) {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, "_library.lock"), deadline = Date.now() + 8_000;
  while (true) {
    try {
      const handle = await fs.open(file, "wx");
      await handle.writeFile(String(process.pid));
      return async () => { await handle.close(); await fs.unlink(file); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await fs.readFile(file, "utf8").catch(() => ""));
      if (pid > 0) {
        try { process.kill(pid, 0); } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ESRCH") { await fs.unlink(file).catch(() => {}); continue; }
        }
      }
      if (Date.now() > deadline) throw new Error("素材库正在处理其他操作，请稍后重试");
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  }
}
async function write(root: string, data: PersonalLibrary) {
  const temp = path.join(root, `_catalog-${randomUUID()}.tmp`);
  try { await fs.writeFile(temp, JSON.stringify(data, null, 2)); await fs.rename(temp, path.join(root, "_catalog.json")); }
  finally { await fs.rm(temp, { force: true }); }
}
async function read(root: string, readOnly = false): Promise<PersonalLibrary> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(root, "_catalog.json"), "utf8"));
    if (value.version !== 1 || !Array.isArray(value.folders) || !Array.isArray(value.items)) throw new Error("素材库目录损坏，请保留文件并联系管理员");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (readOnly) return { version: 1, folders: [], items: [] };
    const data: PersonalLibrary = { version: 1, folders: PERSONAL_LIBRARY_DEFAULTS.map(name => ({ id: randomUUID(), name, parentId: null })), items: [] };
    for (const folder of data.folders) await fs.mkdir(path.join(root, folder.name), { recursive: true });
    await write(root, data); return data;
  }
}
async function withLibrary<T>(userId: number, action: (root: string, data: PersonalLibrary) => Promise<T>, readOnly = false) {
  const root = rootFor(userId);
  // Catalog publication is atomic. Observers never lock, initialize or migrate it.
  if (readOnly) return action(root, await read(root, true));
  const release = await lock(root);
  try { await migrateLegacyCanvasLibrary(userId); return await action(root, await read(root)); } finally { await release(); }
}
export async function getPersonalLibrary(userId: number, readOnly = false) { return withLibrary(userId, async (_root, data) => data, readOnly); }
export async function withPersonalMaterial<T>(userId: number, id: string, action: (item: PersonalMaterial, file: string) => Promise<T>, readOnly = false) {
  return withLibrary(userId, async (root, data) => {
    const item = data.items.find(it => it.id === id);
    if (!item) throw new Error("素材不存在或无权访问");
    return action(item, diskFile(root, data, item));
  }, readOnly);
}
export async function addPersonalMaterial(userId: number, folderId: string | null, input: Omit<PersonalMaterial, "id" | "fileName" | "folderId" | "createdAt">, bytes: Buffer, extension: string) {
  if (!/^[a-z0-9]+$/.test(extension)) throw new Error("无效文件类型");
  return withLibrary(userId, async (root, data) => {
    personalFolderPath(data, folderId);
    const id = randomUUID();
    const item: PersonalMaterial = { ...input, name: input.name.slice(0, 240), id, folderId, fileName: `${id}.${extension}`, createdAt: new Date().toISOString() };
    const file = diskFile(root, data, item);
    await fs.writeFile(file, bytes, { flag: "wx" });
    data.items.push(item);
    try { await write(root, data); } catch (error) { await fs.unlink(file); throw error; }
    return item;
  });
}
export type LibraryAction = { operation: "create" | "rename" | "move" | "copy" | "delete"; type: "folder" | "item"; id?: string; name?: string; parentId?: string | null };
export async function changePersonalLibrary(userId: number, action: LibraryAction) {
  return withLibrary(userId, async (root, data) => {
    const before = structuredClone(data);
    const undo: Array<() => Promise<unknown>> = [];
    const moved: Array<{ from: string; to: string }> = [];
    const move = async (from: string, to: string) => { await fs.rename(from, to); moved.push({ from: path.relative(root, from), to: path.relative(root, to) }); undo.push(() => fs.rename(to, from)); };
    const mkdir = async (dir: string) => { await fs.mkdir(dir); undo.push(() => fs.rm(dir, { recursive: true, force: true })); };
    try {
      if (action.type === "folder") {
        const folder = data.folders.find(f => f.id === action.id);
        const parentId = action.parentId ?? null;
        if (action.operation === "create") {
          const name = safeName(action.name || ""); availableName(data, parentId, name);
          const next: PersonalFolder = { id: randomUUID(), name, parentId };
          data.folders.push(next); await mkdir(path.join(root, personalFolderPath(data, next.id)));
        } else {
          if (!folder) throw new Error("文件夹不存在");
          const source = path.join(root, personalFolderPath(data, folder.id));
          const descendants = new Set([folder.id]);
          for (let n=0; n<data.folders.length; n++) for (const f of data.folders) if (f.parentId && descendants.has(f.parentId)) descendants.add(f.id);
          if ((action.operation === "move" || action.operation === "copy") && parentId && descendants.has(parentId)) throw new Error("不能放入自身或子文件夹");
          if (action.operation === "rename" || action.operation === "move") {
            const name = action.operation === "rename" ? safeName(action.name || "") : folder.name;
            const target = action.operation === "move" ? parentId : folder.parentId;
            availableName(data, target, name, folder.id);
            folder.name = name; folder.parentId = target;
            const destination = path.join(root, personalFolderPath(data, folder.id));
            if (source !== destination) await move(source, destination);
          } else if (action.operation === "copy") {
            let name = `${folder.name} 副本`, suffix = 2;
            while (data.folders.some(f => f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase())) name = `${folder.name} 副本 ${suffix++}`;
            availableName(data, parentId, name);
            const ids = new Map([...descendants].map(id => [id, randomUUID()]));
            const originalFolders = before.folders.filter(f => descendants.has(f.id));
            data.folders.push(...originalFolders.map(f => ({ ...f, id: ids.get(f.id)!, name: f.id === folder.id ? name : f.name, parentId: f.id === folder.id ? parentId : ids.get(f.parentId!)! })));
            const targetRoot = path.join(root, personalFolderPath(data, ids.get(folder.id)!));
            await mkdir(targetRoot);
            for (const f of originalFolders) if (f.id !== folder.id) await fs.mkdir(path.join(root, personalFolderPath(data, ids.get(f.id)!)), { recursive: true });
            for (const item of before.items.filter(it => it.folderId && descendants.has(it.folderId))) {
              const id = randomUUID(), copy = { ...item, id, fileName: id + path.extname(item.fileName), folderId: ids.get(item.folderId!)!, createdAt: new Date().toISOString() };
              await fs.copyFile(diskFile(root, before, item), diskFile(root, data, copy)); data.items.push(copy);
            }
          } else if (action.operation === "delete") {
            const trash = path.join(root, "_trash"); await fs.mkdir(trash, { recursive: true });
            await move(source, path.join(trash, randomUUID()));
            data.folders = data.folders.filter(f => !descendants.has(f.id));
            data.items = data.items.filter(it => !it.folderId || !descendants.has(it.folderId));
          } else throw new Error("不支持的文件夹操作");
        }
      } else if (action.type === "item") {
        const item = data.items.find(it => it.id === action.id);
        if (!item) throw new Error("素材不存在");
        const source = diskFile(root, data, item);
        if (action.operation === "rename") {
          const name = String(action.name || "").trim(); if (!name || name.length > 240) throw new Error("请输入有效素材名称"); item.name = name;
        } else if (action.operation === "move") {
          personalFolderPath(data, action.parentId ?? null); item.folderId = action.parentId ?? null;
          const destination = diskFile(root, data, item); if (source !== destination) await move(source, destination);
        } else if (action.operation === "copy") {
          const folderId = action.parentId === undefined ? item.folderId : action.parentId;
          personalFolderPath(data, folderId);
          const id = randomUUID(); let name = `${item.name} 副本`, suffix = 2;
          while (data.items.some(it => it.folderId === folderId && it.name === name)) name = `${item.name} 副本 ${suffix++}`;
          const copy = { ...item, id, folderId, name, fileName: id + path.extname(item.fileName), createdAt: new Date().toISOString() };
          const destination = diskFile(root, data, copy); await fs.copyFile(source, destination); undo.push(() => fs.unlink(destination)); data.items.push(copy);
        } else if (action.operation === "delete") {
          const trash = path.join(root, "_trash"); await fs.mkdir(trash, { recursive: true });
          await move(source, path.join(trash, item.fileName)); data.items = data.items.filter(it => it.id !== item.id);
        } else throw new Error("不支持的素材操作");
      } else throw new Error("无效操作对象");
      // Retain the pre-delete catalog with the removed files for recovery.
      if (action.operation === "delete") await fs.writeFile(path.join(root, "_trash", `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ catalog: before, moved }));
      await write(root, data); return data;
    } catch (error) {
      for (const revert of undo.reverse()) await revert();
      throw error;
    }
  });
}
export async function personalFolderDownload(userId: number, folderId: string, readOnly = false) {
  return withLibrary(userId, async (root, data) => {
    const folder = data.folders.find(f => f.id === folderId); if (!folder) throw new Error("文件夹不存在");
    const prefix = personalFolderPath(data, folderId);
    const items = data.items.filter(it => { const p = personalFolderPath(data, it.folderId); return p === prefix || p.startsWith(prefix + path.sep); });
    if (items.reduce((sum, it) => sum + it.size, 0) > 512 * 1024 * 1024) throw new Error("文件夹超过 512MB，请分批下载");
    const JSZip = (await import("jszip")).default, zip = new JSZip();
    for (const f of data.folders) { const p = personalFolderPath(data, f.id); if (p === prefix || p.startsWith(prefix + path.sep)) zip.folder(path.join(folder.name, path.relative(prefix, p)).replaceAll("\\", "/")); }
    for (const it of items) {
      const name = personalMaterialDownloadName(it).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+/, "_") || it.fileName;
      const dir = path.join(folder.name, path.relative(prefix, personalFolderPath(data, it.folderId)));
      let target = path.join(dir, name).replaceAll("\\", "/"); if (zip.file(target)) target = path.join(dir, `${it.id}-${name}`).replaceAll("\\", "/");
      zip.file(target, await fs.readFile(diskFile(root, data, it)));
    }
    return { name: folder.name, bytes: await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }) };
  }, readOnly);
}
