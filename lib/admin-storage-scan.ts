// 抽离自 app/api/admin/storage/route.ts，让后台 cron 也能调用。
// 单纯做磁盘 + OSS 体积统计，返回一个可序列化的 snapshot。

import fs from "fs-extra";
import path from "path";
import { resolvePublicPath } from "@/lib/public-path";
import { getOssPrefixStats, isOssReady } from "@/lib/oss";

export type StorageCategory = {
  folder: string;
  label: string;
  bytes: number;
  files: number;
  source: "local" | "oss" | "mixed";
};

export type StorageDirNode = {
  name: string;
  relativePath: string;
  label: string;
  purpose: string;
  bytes: number;
  files: number;
  children: StorageDirNode[];
};

export type StorageScanSnapshot = {
  scannedAt: string;
  uploadsRoot: string;
  categories: StorageCategory[];
  uploadsTree: StorageDirNode[];
  totalBytes: number;
  totalFiles: number;
};

type StorageCategoryDef = {
  folder: string;
  label: string;
  localDir: string;
  ossPrefix: string;
};

const STORAGE_CATEGORY_DEFS: StorageCategoryDef[] = [
  { folder: "canvas_imports", label: "画布导入素材", localDir: "canvas_imports", ossPrefix: "uploads/canvas_imports/" },
  { folder: "canvas_image_results", label: "画布图片结果", localDir: "canvas_image_results", ossPrefix: "uploads/canvas_image_results/" },
  { folder: "canvas_video_results", label: "画布视频结果", localDir: "canvas_video_results", ossPrefix: "uploads/canvas_video_results/" },
  { folder: "canvas_audio_results", label: "画布音频结果", localDir: "canvas_audio_results", ossPrefix: "uploads/canvas_audio_results/" },
  { folder: "canvas_voice_previews", label: "画布音色试听", localDir: "canvas_voice_previews", ossPrefix: "uploads/canvas_voice_previews/" },
  { folder: "Agent_imports", label: "Agent 导入素材", localDir: "Agent_imports", ossPrefix: "uploads/Agent_imports/" },
  { folder: "Agent_image_results", label: "Agent 图片结果", localDir: "Agent_image_results", ossPrefix: "uploads/Agent_image_results/" },
  { folder: "Agent_video_results", label: "Agent 视频结果", localDir: "Agent_video_results", ossPrefix: "uploads/Agent_video_results/" },
  { folder: "Agent_audio_results", label: "Agent 音频结果", localDir: "Agent_audio_results", ossPrefix: "uploads/Agent_audio_results/" },
  { folder: "imports", label: "创作导入的素材", localDir: "imports", ossPrefix: "uploads/imports/" },
  { folder: "image_results", label: "创作图片结果", localDir: "image_results", ossPrefix: "uploads/image_results/" },
  { folder: "face_results", label: "换脸结果", localDir: "face_results", ossPrefix: "uploads/face_results/" },
  { folder: "video_results", label: "创作视频结果", localDir: "video_results", ossPrefix: "uploads/video_results/" },
  { folder: "products_shared_image", label: "产品库 / 共享图片", localDir: "products/shared/image", ossPrefix: "uploads/products/shared/image/" },
  { folder: "products_shared_video", label: "产品库 / 共享视频", localDir: "products/shared/video", ossPrefix: "uploads/products/shared/video/" },
  { folder: "products_private_total", label: "产品库 / 私有文件", localDir: "products/private", ossPrefix: "uploads/products/private/" },
  { folder: "material_library_total", label: "素材库", localDir: "material_library", ossPrefix: "uploads/material_library/" },
  { folder: "temp", label: "临时目录", localDir: "temp", ossPrefix: "uploads/temp/" },
  { folder: "presets", label: "预设文件", localDir: "presets", ossPrefix: "uploads/presets/" },
  { folder: "role_skill_covers", label: "技能资源", localDir: "role_skill_covers", ossPrefix: "uploads/role_skill_covers/" },
];

function getUploadsRootDir() {
  const configured = String(process.env.UPLOADS_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return resolvePublicPath("uploads");
}

function getDirMeta(relativePath: string, name: string) {
  const exact: Record<string, { label: string; purpose: string }> = {
    "uploads/canvas_imports": { label: "画布导入素材", purpose: "存放画布拖入、粘贴和上传的图片、视频与音频" },
    "uploads/canvas_image_results": { label: "画布图片结果", purpose: "存放画布生成的图片结果" },
    "uploads/canvas_video_results": { label: "画布视频结果", purpose: "存放画布生成的视频结果" },
    "uploads/canvas_audio_results": { label: "画布音频结果", purpose: "存放画布生成的独立音频结果" },
    "uploads/canvas_voice_previews": { label: "画布音色试听", purpose: "存放 MiniMax 音色试听样音；文件存在时免费复用，删除后下次试听重新生成" },
    "uploads/Agent_imports": { label: "Agent 导入素材", purpose: "存放 Agent 页面直接上传的图片、视频与音频原文件" },
    "uploads/Agent_image_results": { label: "Agent 图片结果", purpose: "存放 Agent 生成与编辑的图片结果" },
    "uploads/Agent_video_results": { label: "Agent 视频结果", purpose: "存放 Agent 生成的视频结果" },
    "uploads/Agent_audio_results": { label: "Agent 音频结果", purpose: "存放 Agent 生成的音频结果" },
    "uploads/imports": { label: "创作导入的素材", purpose: "存放创作工具上传、导入及输入快照素材" },
    "uploads/batch_imports": { label: "批量导入的素材", purpose: "该目录下存放对应业务的文件或子目录" },
    "uploads/batch-image_results": { label: "批量结果素材", purpose: "存放批量创作生成的图片结果" },
    "uploads/image_results": { label: "创作图片结果", purpose: "存放图片生成、图片编辑等输出结果" },
    "uploads/face_results": { label: "换脸结果", purpose: "存放换脸、人脸修复等输出结果" },
    "uploads/video_results": { label: "创作视频结果", purpose: "存放视频生成与视频处理结果" },
    "uploads/products": { label: "产品库", purpose: "产品库相关素材的总目录" },
    "uploads/products/shared": { label: "产品库共享素材", purpose: "面向全员共享的产品素材目录" },
    "uploads/products/shared/image": { label: "产品库共享图片", purpose: "产品库中共享图片素材" },
    "uploads/products/shared/video": { label: "产品库共享视频", purpose: "产品库中共享视频素材" },
    "uploads/products/private": { label: "产品库私有文件", purpose: "按用户隔离的产品私有素材" },
    "uploads/material_library": { label: "素材库", purpose: "后台素材库页面管理的共享素材" },
    "uploads/temp": { label: "临时目录", purpose: "临时缓存、中间文件与待清理文件" },
    "uploads/presets": { label: "预设文件", purpose: "工具预设、配置快照与相关文件" },
    "uploads/role_skill_covers": { label: "技能资源", purpose: "系统技能与个人技能的封面及本地文件工作区" },
    "uploads/role_skill_covers/system": { label: "系统技能资源", purpose: "管理员维护的系统技能封面与文件工作区" },
    "uploads/role_skill_covers/system/workspaces": { label: "系统技能工作区", purpose: "按技能 ID 隔离保存的系统 Skill 文件和目录" },
    "uploads/role_skill_covers/users": { label: "个人技能资源", purpose: "按账号隔离的个人技能封面与文件工作区" },
    "uploads/generation_previews": { label: "图片预览生成", purpose: "生成结果的预览缩略图，按生成日期分子目录存放" },
    "uploads/generation_posters": { label: "海报生成", purpose: "生成结果的合成海报图，按生成日期分子目录存放" },
    "uploads/_thumbs": { label: "缩略图缓存", purpose: "列表与网格缩略图的磁盘缓存，由 /api/thumb 自动生成，可安全清理（清掉后访问会自动重建）" },
    "uploads/inspiration_assets": { label: "灵感模板素材", purpose: "灵感模板的预览图/视频与输入输出示例素材" },
    "uploads/inspiration_assets/images": { label: "模板示例图片", purpose: "灵感模板用到的图片素材" },
    "uploads/inspiration_assets/videos": { label: "模板示例视频", purpose: "灵感模板用到的视频素材" },
  };
  if (exact[relativePath]) return exact[relativePath];
  if (relativePath.startsWith("uploads/generation_previews/")) {
    return { label: name, purpose: "该日期生成的预览图" };
  }
  if (relativePath.startsWith("uploads/generation_posters/")) {
    return { label: name, purpose: "该日期生成的海报图" };
  }
  if (relativePath.startsWith("uploads/products/private/")) {
    return { label: `${name}（私有目录）`, purpose: "某个用户或业务的私有产品素材子目录" };
  }
  if (relativePath.startsWith("uploads/presets/")) {
    return { label: `${name}（预设子目录）`, purpose: "某个用户或作用域下的预设文件目录" };
  }
  if (relativePath.startsWith("uploads/role_skill_covers/users/")) {
    if (relativePath.includes("/workspaces")) {
      return { label: `${name}（个人技能工作区）`, purpose: "按技能 ID 隔离保存的个人 Skill 文件和目录" };
    }
    return { label: `${name}（账号技能资源）`, purpose: "该账号创建的个人技能封面与文件工作区" };
  }
  if (relativePath.startsWith("uploads/material_library/")) {
    return { label: `${name}（素材库子目录）`, purpose: "素材库内部的分类或分组目录" };
  }
  if (relativePath.startsWith("uploads/temp/")) {
    return { label: `${name}（临时子目录）`, purpose: "临时处理过程中生成的中间目录" };
  }
  return { label: name, purpose: "该目录下存放对应业务的文件或子目录" };
}

async function statPathSize(target: string): Promise<{ bytes: number; files: number }> {
  const exists = await fs.pathExists(target).catch(() => false);
  if (!exists) return { bytes: 0, files: 0 };
  const stack = [target];
  let bytes = 0;
  let files = 0;
  while (stack.length) {
    const current = stack.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = await fs.stat(full).catch(() => null);
      if (!st) continue;
      files += 1;
      bytes += Number(st.size || 0);
    }
  }
  return { bytes, files };
}

async function scanOneCategory(
  uploadsRoot: string,
  def: StorageCategoryDef,
  ossEnabled: boolean
): Promise<StorageCategory> {
  const [localStats, ossStats] = await Promise.all([
    statPathSize(path.join(uploadsRoot, def.localDir)),
    ossEnabled
      ? getOssPrefixStats(def.ossPrefix).catch(() => ({ bytes: 0, files: 0 }))
      : Promise.resolve({ bytes: 0, files: 0 }),
  ]);
  const hasLocal = localStats.bytes > 0 || localStats.files > 0;
  const hasOss = ossStats.bytes > 0 || ossStats.files > 0;
  return {
    folder: def.folder,
    label: def.label,
    bytes: localStats.bytes + ossStats.bytes,
    files: localStats.files + ossStats.files,
    source: hasLocal && hasOss ? "mixed" : hasOss ? "oss" : "local",
  };
}

async function scanDirTree(dirPath: string, relativePath: string): Promise<StorageDirNode | null> {
  const exists = await fs.pathExists(dirPath).catch(() => false);
  if (!exists) return null;

  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const childDirs = entries.filter((entry) => entry.isDirectory());
  const childFiles = entries.filter((entry) => entry.isFile());

  let directBytes = 0;
  let directFiles = 0;
  for (const file of childFiles) {
    const fullPath = path.join(dirPath, file.name);
    const st = await fs.stat(fullPath).catch(() => null);
    if (!st) continue;
    directBytes += Number(st.size || 0);
    directFiles += 1;
  }

  const childNodes = (await Promise.all(
    childDirs.map((entry) => scanDirTree(path.join(dirPath, entry.name), `${relativePath}/${entry.name}`))
  )).filter(Boolean) as StorageDirNode[];

  childNodes.sort((a, b) => {
    if (b.bytes !== a.bytes) return b.bytes - a.bytes;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  const nestedBytes = childNodes.reduce((sum, item) => sum + item.bytes, 0);
  const nestedFiles = childNodes.reduce((sum, item) => sum + item.files, 0);

  return {
    name: path.basename(dirPath),
    relativePath,
    ...getDirMeta(relativePath, path.basename(dirPath)),
    bytes: directBytes + nestedBytes,
    files: directFiles + nestedFiles,
    children: childNodes,
  };
}

async function scanUploadsTree(uploadsRoot: string): Promise<StorageDirNode[]> {
  const rootMap = new Map<string, StorageDirNode>();

  function ensureChild(parent: StorageDirNode[], relativePath: string): StorageDirNode {
    const parts = relativePath.split("/").filter(Boolean);
    let currentChildren = parent;
    let currentPath = "";
    let currentNode: StorageDirNode | null = null;
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let found = currentChildren.find((item) => item.name === part);
      if (!found) {
        found = {
          name: part,
          relativePath: currentPath,
          ...getDirMeta(currentPath, part),
          bytes: 0,
          files: 0,
          children: [],
        };
        currentChildren.push(found);
      }
      currentNode = found;
      currentChildren = found.children;
    }
    return currentNode as StorageDirNode;
  }

  function mergeNode(target: StorageDirNode, source: StorageDirNode) {
    target.bytes = source.bytes;
    target.files = source.files;
    for (const child of source.children) {
      const targetChild = ensureChild(target.children, child.relativePath.replace(`${target.relativePath}/`, ""));
      mergeNode(targetChild, child);
    }
  }

  const exists = await fs.pathExists(uploadsRoot).catch(() => false);
  if (exists) {
    const entries = await fs.readdir(uploadsRoot, { withFileTypes: true }).catch(() => []);
    const topDirs = entries.filter((entry) => entry.isDirectory());
    const nodes = (await Promise.all(
      topDirs.map((entry) => scanDirTree(path.join(uploadsRoot, entry.name), `uploads/${entry.name}`))
    )).filter(Boolean) as StorageDirNode[];
    for (const node of nodes) rootMap.set(node.name, node);
  }

  const result: StorageDirNode[] = Array.from(rootMap.values());

  for (const def of STORAGE_CATEGORY_DEFS) {
    const relativePath = `uploads/${def.localDir}`;
    const parts = relativePath.split("/").filter(Boolean);
    const topName = parts[1];
    let topNode = result.find((item) => item.name === topName);
    if (!topNode) {
      topNode = {
        name: topName,
        relativePath: `uploads/${topName}`,
        ...getDirMeta(`uploads/${topName}`, topName),
        bytes: 0,
        files: 0,
        children: [],
      };
      result.push(topNode);
    }
    let cursor = topNode;
    let currentPath = `uploads/${topName}`;
    for (const part of parts.slice(2)) {
      currentPath = `${currentPath}/${part}`;
      let child = cursor.children.find((item) => item.name === part);
      if (!child) {
        child = {
          name: part,
          relativePath: currentPath,
          ...getDirMeta(currentPath, part),
          bytes: 0,
          files: 0,
          children: [],
        };
        cursor.children.push(child);
      }
      cursor = child;
    }
  }

  function sortTree(nodes: StorageDirNode[]) {
    nodes.sort((a, b) => {
      if (b.bytes !== a.bytes) return b.bytes - a.bytes;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    for (const node of nodes) sortTree(node.children);
  }

  sortTree(result);
  return result;
}

export async function scanStorageCategories(): Promise<StorageScanSnapshot> {
  const uploadsRoot = getUploadsRootDir();
  const localStorageOnly = String(process.env.MEDIA_STORAGE_DRIVER || "local").trim().toLowerCase() === "local";
  const ossEnabled = !localStorageOnly && await isOssReady();
  const [categories, uploadsTree] = await Promise.all([
    Promise.all(STORAGE_CATEGORY_DEFS.map((def) => scanOneCategory(uploadsRoot, def, ossEnabled))),
    scanUploadsTree(uploadsRoot),
  ]);
  const totalBytes = categories.reduce((acc, x) => acc + x.bytes, 0);
  const totalFiles = categories.reduce((acc, x) => acc + x.files, 0);
  return {
    scannedAt: new Date().toISOString(),
    uploadsRoot,
    categories,
    uploadsTree,
    totalBytes,
    totalFiles,
  };
}
