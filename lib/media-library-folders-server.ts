import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { folderDestination, planProductFolderChange, productFolders, type ProductFolder, type ProductFolderAction } from "@/lib/media-library-folders";

const keyFor = (userId: number) => `media_library_private_folders:${userId}`;
type Reader = Pick<Prisma.TransactionClient, "appSetting" | "mediaLibraryItem">;
async function readFolders(db: Reader, userId: number) {
  const [setting, rows] = await Promise.all([
    db.appSetting.findUnique({ where: { key: keyFor(userId) } }),
    db.mediaLibraryItem.findMany({ where: { scope: "private", ownerUserId: userId, isDeleted: false, groupName: { not: null } }, select: { groupName: true }, distinct: ["groupName"] }),
  ]);
  const stored: unknown = setting ? JSON.parse(setting.value) : [];
  if (!Array.isArray(stored) || stored.some(value => typeof value !== "string")) throw new Error("目录记录异常，请保留数据并联系管理员");
  return productFolders([...stored, ...rows.map(row => row.groupName || "")]);
}
export const getProductFolders = (userId: number) => readFolders(prisma, userId);

export async function withProductFolders<T>(userId: number, work: (tx: Prisma.TransactionClient, folders: ProductFolder[]) => Promise<T>) {
  // Write the per-user row first: concurrent new uploads, moves and folder edits
  // serialize across web workers. No new table or destructive migration required.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.appSetting.upsert({ where: { key: keyFor(userId) }, create: { key: keyFor(userId), value: "[]" }, update: { updatedAt: new Date() } });
        return work(tx, await readFolders(tx, userId));
      }, { timeout: 15000 });
    } catch (error) {
      if (attempt < 2 && ["P2034", "P2002"].includes(String((error as { code?: string }).code))) continue;
      throw error;
    }
  }
}

export async function changeProductFolders(userId: number, action: ProductFolderAction) {
  if (action.operation === "move") throw new Error("文件夹不能移动，请选择文件夹中的素材进行移动");
  return withProductFolders(userId, async (tx, folders) => {
    if (action.operation === "moveItems" || action.operation === "deleteItems") {
      const groupName = action.operation === "moveItems" ? folderDestination(folders, action.parentId) : null;
      const ids = action.itemIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("请选择有效的素材");
      const uniqueIds = [...new Set(ids)];
      const where = { id: { in: uniqueIds }, ownerUserId: userId, scope: "private", isDeleted: false };
      if (await tx.mediaLibraryItem.count({ where }) !== uniqueIds.length) throw new Error("素材不存在或无权操作");
      await tx.mediaLibraryItem.updateMany({ where, data: action.operation === "deleteItems" ? { isDeleted: true } : { groupName } });
      // Persist legacy groups too, so empty folders survive moving the last item.
      await tx.appSetting.update({ where: { key: keyFor(userId) }, data: { value: JSON.stringify(folders.map(folder => folder.id)) } });
      return { folders, destination: groupName };
    }
    if (!["create", "rename", "delete"].includes(action.operation)) throw new Error("不支持的目录操作");
    const plan = planProductFolderChange(folders, action);
    if (action.operation === "delete") {
      // Keep bytes/URLs available for existing canvas and generation references.
      await tx.mediaLibraryItem.updateMany({ where: { ownerUserId: userId, scope: "private", isDeleted: false, groupName: { in: plan.affected } }, data: { isDeleted: true } });
    } else {
      // Descendants first prevents a moved path from matching a later old path.
      for (const [from, to] of [...plan.changes].sort((a, b) => b[0].length - a[0].length)) {
        await tx.mediaLibraryItem.updateMany({ where: { ownerUserId: userId, scope: "private", isDeleted: false, groupName: from }, data: { groupName: to } });
      }
    }
    await tx.appSetting.update({ where: { key: keyFor(userId) }, data: { value: JSON.stringify(plan.paths) } });
    return { folders: productFolders(plan.paths), destination: plan.destination };
  });
}
