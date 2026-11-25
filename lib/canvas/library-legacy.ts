import fs from "node:fs/promises";
import path from "node:path";
import { resolvePublicPath } from "@/lib/public-path";

// Repeatable migration of old flat UUID files. New catalogs/categories are untouched.
export async function migrateLegacyCanvasLibrary(userId: number) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("无效用户");
  const base = path.resolve(resolvePublicPath("uploads"));
  const source = path.join(base, "canvas-library", String(userId));
  const archive = path.join(base, "canvas-library-legacy", String(userId));
  const workflows = path.join(base, "canvas-workflows", String(userId));
  for (const target of [source, archive, workflows]) {
    if (!path.resolve(target).startsWith(base + path.sep)) throw new Error("目录越界");
  }
  const entries = await fs.readdir(source, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []; throw error;
  });
  const legacyIds = new Set(entries.filter(entry => entry.isFile() && /^[a-f0-9-]{36}\.json$/i.test(entry.name)).map(entry => entry.name.slice(0, -5)));
  const files = entries.filter(entry => entry.isFile() && (legacyIds.has(entry.name.slice(0, 36)) || entry.name === "_folders.json"));
  if (!files.length) return { userId, archived: 0 };
  await fs.mkdir(archive, { recursive: true });
  // Copy and verify all files before removing their original directory entries.
  for (const file of files) {
    const from = path.join(source, file.name), to = path.join(archive, file.name);
    const bytes = await fs.readFile(from);
    try { await fs.writeFile(to, bytes, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (!(await fs.readFile(to)).equals(bytes)) throw new Error(`归档内容冲突：${file.name}`);
  }
  for (const file of files.filter(f => /^[a-f0-9-]{36}\.json$/i.test(f.name))) {
    const item = JSON.parse(await fs.readFile(path.join(archive, file.name), "utf8"));
    if (item.kind !== "file") continue;
    const prefix = `/uploads/canvas-library/${userId}/`;
    if (typeof item.url !== "string" || !item.url.startsWith(prefix)) throw new Error("旧工作流路径无效");
    const filename = item.url.slice(prefix.length);
    if (!/^[a-f0-9-]{36}\.canvas\.json$/i.test(filename)) throw new Error("旧工作流文件名无效");
    await fs.mkdir(workflows, { recursive: true });
    const bytes = await fs.readFile(path.join(archive, filename));
    const destination = path.join(workflows, filename);
    try { await fs.writeFile(destination, bytes, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await fs.readFile(destination)).equals(bytes)) throw error; }
    const next = { ...item, url: item.url.replace(prefix, `/uploads/canvas-workflows/${userId}/`), thumbnailUrl: String(item.thumbnailUrl || "").replace(prefix, `/uploads/canvas-workflows/${userId}/`) };
    await fs.writeFile(path.join(workflows, file.name), JSON.stringify(next, null, 2));
  }
  for (const file of files) await fs.unlink(path.join(source, file.name));
  return { userId, archived: files.length };
}
