// 画布临时上传孤儿清理：删除当前商家拥有且未被任何画布引用、超过宽限期的画布导入文件。
//
// 宽限期默认 24h，避免误删刚上传/在途文件。回收站画布(30 天可恢复)也算「被引用」，其文件保留。
// 同时兼容旧的 {userId}/{date} 路径和新的 {merchant}_{YYYYMMDD} 路径，绝不碰 canvas-library / media-library。

import path from "path";
import fs from "fs-extra";
import prisma from "@/lib/prisma";
import { resolvePublicPath } from "@/lib/public-path";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { collectCanvasImportRefs, normalizeCanvasImportRef } from "@/lib/canvas/import-refs";

const GRACE_MS = 24 * 60 * 60 * 1000;

async function walkFiles(dir: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkFiles(full)));
    else out.push(full);
  }
  return out;
}

/** 返回删除的文件数。 */
export async function cleanupOrphanCanvasUploads(userId: number, graceMs = GRACE_MS): Promise<number> {
  const userDir = resolvePublicPath("uploads", "canvas_imports", String(userId));
  const [canvases, ownedAssets] = await Promise.all([
    prisma.canvas.findMany({ where: { authUserId: userId }, select: { data: true } }),
    prisma.mediaAsset.findMany({
      where: {
        ownerUserId: userId,
        storageProvider: "local",
        publicUrl: { startsWith: "/uploads/canvas_imports/" },
      },
      select: { publicUrl: true },
    }),
  ]);
  const referenced = new Set<string>();
  for (const c of canvases) {
    for (const ref of collectCanvasImportRefs(c.data)) referenced.add(ref);
  }

  const now = Date.now();
  const uploadRoot = resolvePublicPath("uploads");
  const files = new Set(await walkFiles(userDir));
  for (const asset of ownedAssets) {
    const ref = normalizeCanvasImportRef(asset.publicUrl);
    if (!ref) continue;
    const abs = path.resolve(uploadRoot, ref.slice("/uploads/".length));
    const relative = path.relative(uploadRoot, abs);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    files.add(abs);
  }
  const candidates: string[] = [];
  for (const abs of files) {
    const rel = path.relative(resolvePublicPath(), abs).replaceAll("\\", "/");
    const url = `/${rel}`;
    if (!url.startsWith("/uploads/canvas_imports/")) continue;
    if (referenced.has(url)) continue;
    try {
      const stat = await fs.stat(abs);
      if (now - stat.mtimeMs < graceMs) continue; // 宽限期内不动
      candidates.push(url);
    } catch {
      /* 跳过 */
    }
  }
  if (!candidates.length) return 0;
  const result = await deleteStoredMediaRefs(candidates);
  return result.deletedLocalFiles + result.deletedOssObjects;
}
