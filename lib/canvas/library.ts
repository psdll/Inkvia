// 画布产物库 —— per-item 文件存储，单/多进程都免锁，与 media-library / 资产零耦合。
//
// 工作流专用目录：public/uploads/canvas-workflows/{userId}/
//   - {id}.json          每条产物的元数据
//   - {id}.<ext>         产物媒体文件（收藏=复制进库，自包含）
//   - _folders.json      文件夹名清单（含空文件夹；default 始终存在）
//
// 收藏只接受站内 /uploads/... URL（防 SSRF）；所有路径禁止穿越，只操作当前用户目录。

import path from "path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { resolvePublicPath, resolvePublicDir } from "@/lib/public-path";
import { getPersonalLibrary } from "./personal-library";

export type CanvasLibKind = "image" | "video" | "audio" | "file";

export type CanvasLibItem = {
  id: string;
  url: string;
  thumbnailUrl: string;
  kind: CanvasLibKind;
  name: string;
  folder: string;
  prompt?: string;
  model?: string;
  createdAt: string;
};

const DEFAULT_FOLDER = "default";

function userDir(userId: number) {
  return resolvePublicPath("uploads", "canvas-workflows", String(userId));
}

function kindFromExt(ext: string): CanvasLibKind {
  const e = ext.replace(/^\./, "").toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "tiff"].includes(e)) return "image";
  if (["mp4", "webm", "mov", "mkv"].includes(e)) return "video";
  if (["mp3", "wav", "aac", "ogg", "flac", "m4a"].includes(e)) return "audio";
  return "file";
}

function safeFolder(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return DEFAULT_FOLDER;
  // 文件夹名只是元数据标签，不参与路径；做基本清洗即可。
  return s.replace(/[\\/]+/g, "_").slice(0, 60) || DEFAULT_FOLDER;
}

function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

/** 把站内 /uploads/... URL 解析为 public 下的绝对路径；非站内或越界返回 null。 */
export function resolveStationFile(url: string): string | null {
  const raw = String(url || "").trim();
  if (!raw.startsWith("/uploads/")) return null;
  if (raw.includes("..")) return null;
  // 去掉查询串
  const clean = raw.split("?")[0].split("#")[0];
  const decoded = decodeURIComponent(clean);
  if (decoded.includes("..")) return null;
  const publicDir = resolvePublicDir();
  const abs = path.join(publicDir, decoded.replace(/^\/+/, ""));
  const uploadsDir = path.join(publicDir, "uploads");
  if (!abs.startsWith(uploadsDir)) return null;
  return abs;
}

// —— 文件夹 ——
async function readFolders(userId: number): Promise<string[]> {
  await getPersonalLibrary(userId);
  const fp = path.join(userDir(userId), "_folders.json");
  try {
    const json = await fs.readJson(fp);
    const arr = Array.isArray(json) ? json.map((x) => safeFolder(x)) : [];
    if (!arr.includes(DEFAULT_FOLDER)) arr.unshift(DEFAULT_FOLDER);
    return Array.from(new Set(arr));
  } catch {
    return [DEFAULT_FOLDER];
  }
}

async function writeFolders(userId: number, folders: string[]) {
  const dir = userDir(userId);
  await fs.ensureDir(dir);
  const list = Array.from(new Set([DEFAULT_FOLDER, ...folders.map(safeFolder)]));
  const fp = path.join(dir, "_folders.json");
  const tmp = `${fp}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fs.move(tmp, fp, { overwrite: true });
}

export async function listFolders(userId: number): Promise<string[]> {
  return readFolders(userId);
}

export async function addFolder(userId: number, name: string): Promise<string[]> {
  const folders = await readFolders(userId);
  folders.push(safeFolder(name));
  await writeFolders(userId, folders);
  return readFolders(userId);
}

export async function renameFolder(userId: number, from: string, to: string): Promise<string[]> {
  const f = safeFolder(from);
  const t = safeFolder(to);
  if (f === DEFAULT_FOLDER) return readFolders(userId); // 默认夹不可改名
  const folders = (await readFolders(userId)).map((x) => (x === f ? t : x));
  await writeFolders(userId, folders);
  // 迁移该夹下条目
  const items = await listItems(userId);
  await Promise.all(items.filter((it) => it.folder === f).map((it) => writeItem(userId, { ...it, folder: t })));
  return readFolders(userId);
}

export async function deleteFolder(userId: number, name: string): Promise<string[]> {
  const f = safeFolder(name);
  if (f === DEFAULT_FOLDER) return readFolders(userId);
  const folders = (await readFolders(userId)).filter((x) => x !== f);
  await writeFolders(userId, folders);
  // 该夹下条目移回 default
  const items = await listItems(userId);
  await Promise.all(items.filter((it) => it.folder === f).map((it) => writeItem(userId, { ...it, folder: DEFAULT_FOLDER })));
  return readFolders(userId);
}

// —— 条目 ——
async function writeItem(userId: number, item: CanvasLibItem) {
  const dir = userDir(userId);
  await fs.ensureDir(dir);
  const fp = path.join(dir, `${item.id}.json`);
  const tmp = `${fp}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(item, null, 2), "utf8");
  await fs.move(tmp, fp, { overwrite: true });
}

export async function listItems(userId: number, folder?: string): Promise<CanvasLibItem[]> {
  await getPersonalLibrary(userId);
  const dir = userDir(userId);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const items: CanvasLibItem[] = [];
  for (const n of names) {
    if (!n.endsWith(".json") || n.startsWith("_")) continue;
    try {
      const it = (await fs.readJson(path.join(dir, n))) as CanvasLibItem;
      if (it && it.id) items.push(it);
    } catch {
      /* 跳过损坏条目 */
    }
  }
  const filtered = folder ? items.filter((it) => it.folder === safeFolder(folder)) : items;
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return filtered;
}

export async function getItem(userId: number, id: string): Promise<CanvasLibItem | null> {
  if (!isSafeId(id)) return null;
  await getPersonalLibrary(userId);
  try {
    return (await fs.readJson(path.join(userDir(userId), `${id}.json`))) as CanvasLibItem;
  } catch {
    return null;
  }
}

/** 把一个 Buffer 存入库并写元数据，返回条目。 */
export async function addBuffer(
  userId: number,
  buffer: Buffer,
  opts: { ext: string; name: string; folder?: string; prompt?: string; model?: string },
): Promise<CanvasLibItem> {
  const dir = userDir(userId);
  await fs.ensureDir(dir);
  const id = uuidv4();
  const ext = (opts.ext || "bin").replace(/^\./, "").toLowerCase();
  const mediaName = `${id}.${ext}`;
  await fs.writeFile(path.join(dir, mediaName), buffer);
  const url = `/uploads/canvas-workflows/${userId}/${mediaName}`;
  const item: CanvasLibItem = {
    id,
    url,
    thumbnailUrl: url,
    kind: kindFromExt(ext),
    name: opts.name || mediaName,
    folder: safeFolder(opts.folder),
    prompt: opts.prompt,
    model: opts.model,
    createdAt: new Date().toISOString(),
  };
  await writeItem(userId, item);
  return item;
}

/** 收藏站内 URL：复制源文件进库（自包含）。源非站内/越界则抛错。 */
export async function addFromStationUrl(
  userId: number,
  url: string,
  opts: { name?: string; folder?: string; prompt?: string; model?: string } = {},
): Promise<CanvasLibItem> {
  const src = resolveStationFile(url);
  if (!src) throw new Error("仅支持收藏站内 /uploads/ 文件");
  if (!(await fs.pathExists(src))) throw new Error("源文件不存在");
  const buffer = await fs.readFile(src);
  const ext = path.extname(src).replace(/^\./, "") || "png";
  const name = opts.name || path.basename(src);
  return addBuffer(userId, buffer, { ext, name, folder: opts.folder, prompt: opts.prompt, model: opts.model });
}

export async function updateItem(
  userId: number,
  id: string,
  patch: { name?: string; folder?: string },
): Promise<CanvasLibItem | null> {
  const item = await getItem(userId, id);
  if (!item) return null;
  const next: CanvasLibItem = {
    ...item,
    ...(patch.name !== undefined ? { name: String(patch.name).slice(0, 120) } : {}),
    ...(patch.folder !== undefined ? { folder: safeFolder(patch.folder) } : {}),
  };
  await writeItem(userId, next);
  return next;
}

export async function deleteItem(userId: number, id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const item = await getItem(userId, id);
  const dir = userDir(userId);
  await fs.remove(path.join(dir, `${id}.json`)).catch(() => undefined);
  if (item) {
    const mediaAbs = resolveStationFile(item.url);
    if (mediaAbs) await fs.remove(mediaAbs).catch(() => undefined);
  }
  return true;
}
