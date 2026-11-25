import { MEDIA_LIBRARY_UNGROUPED } from "@/lib/media-library";

export type ProductFolder = { id: string; name: string; parentId: string | null };
export type ProductFolderAction = { operation: "create" | "rename" | "move" | "delete" | "moveItems" | "deleteItems"; id?: string; parentId?: string | null; name?: string; itemIds?: number[] };

// Folder paths live in the existing groupName field. File URLs never change.
export function productFolders(paths: string[]): ProductFolder[] {
  const all = new Set<string>();
  for (const path of paths.filter(Boolean)) {
    all.add(path);
    let parent = path.lastIndexOf("/");
    while (parent > 0) { all.add(path.slice(0, parent)); parent = path.lastIndexOf("/", parent - 1); }
  }
  return [...all].sort((a, b) => a.localeCompare(b, "zh-CN")).map(id => {
    const slash = id.lastIndexOf("/");
    return { id, name: slash > 0 ? id.slice(slash + 1) : id, parentId: slash > 0 ? id.slice(0, slash) : null };
  });
}

export function folderDestination(folders: ProductFolder[], id: unknown) {
  if (id === MEDIA_LIBRARY_UNGROUPED) return null;
  if (typeof id !== "string" || !folders.some(folder => folder.id === id)) throw new Error("请选择有效的文件夹");
  return id;
}

export function planProductFolderChange(folders: ProductFolder[], action: ProductFolderAction) {
  const paths = folders.map(folder => folder.id);
  const source = folders.find(folder => folder.id === action.id);
  if (action.operation !== "create" && !source) throw new Error("文件夹不存在，请刷新后重试");
  const affected = source ? paths.filter(id => id === source.id || id.startsWith(source.id + "/")) : [];
  if (action.operation === "delete") return { paths: paths.filter(id => !affected.includes(id)), affected, changes: [] as [string, string][], destination: null };
  const parent = action.operation === "rename" ? source!.parentId : action.parentId || null;
  if (parent && !paths.includes(parent)) throw new Error("目标文件夹不存在");
  if (source && parent && affected.includes(parent)) throw new Error("不能移动到自身或子文件夹");
  const name = action.operation === "move" ? source!.name : String(action.name || "").trim().replace(/\s+/g, " ");
  if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name === "." || name === ".." || name === "all" || name === MEDIA_LIBRARY_UNGROUPED) throw new Error("请输入有效的文件夹名称，不能包含路径符号");
  const destination = parent ? `${parent}/${name}` : name;
  const changes: [string, string][] = source ? affected.map(id => [id, destination + id.slice(source.id.length)]) : [];
  const next = source ? changes.map(([, to]) => to) : [destination];
  if (next.some(id => id.length > 80)) throw new Error("文件夹完整路径不能超过 80 个字符");
  const untouched = paths.filter(id => !affected.includes(id));
  if (next.some(id => untouched.some(existing => existing.toLocaleLowerCase() === id.toLocaleLowerCase()))) throw new Error("目标位置已有同名文件夹");
  return { paths: [...untouched, ...next], affected, changes, destination };
}
