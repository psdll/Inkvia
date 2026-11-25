import path from "path";
import fs from "fs-extra";
import { resolvePublicPath } from "@/lib/public-path";
import { saveBufferFile, saveRemoteFile } from "@/lib/storage";
import { PROTECTED_UPLOAD_ROOTS } from "@/lib/upload-buckets";

// generation 的输入素材统一落到 imports/（与本地上传同一目录），
// 与产品库/素材库等"高流动性源目录"解耦：源文件随时可删，generation 始终引用自己在 imports 下的副本。
const SNAPSHOT_FOLDER = "imports";

function libraryUploadPath(value: string): string {
  const input = String(value || "").trim().replaceAll("\\", "/");
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) {
    try {
      return new URL(input).pathname;
    } catch {
      return "";
    }
  }
  return input.startsWith("uploads/") ? `/${input}` : input;
}

function isLibraryPath(value: string): boolean {
  const uploadPath = libraryUploadPath(value);
  return PROTECTED_UPLOAD_ROOTS.some((root) => uploadPath.startsWith(root));
}

// 把一个本地 /uploads/... 路径复制一份到 imports/；源文件不存在时阻止创建脆弱任务。
export async function copyUploadPathToImports(uploadPath: string): Promise<string> {
  const rel = String(uploadPath || "").replace(/^\/+/, "");
  if (!rel) return uploadPath;
  const src = resolvePublicPath(rel);
  const exists = await fs.pathExists(src).catch(() => false);
  if (!exists) throw new Error("源素材不存在，无法创建任务独立快照");

  const buffer = await fs.readFile(src);
  const ext = path.extname(src).replace(/^\./, "") || "bin";
  return saveBufferFile(buffer, SNAPSHOT_FOLDER, { fallbackExt: ext });
}

// 对 imagePaths 中所有来自受保护源目录（产品库/素材库）的本地路径或远程 URL 执行快照复制，
// 返回替换后的 imports 路径数组；其它路径（含已在 imports 下的本地上传）原样返回。
export async function snapshotLibraryInputs(imagePaths: string[]): Promise<string[]> {
  return Promise.all(
    imagePaths.map((p) =>
      typeof p === "string" && isLibraryPath(p)
        ? /^https?:\/\//i.test(p)
          ? saveRemoteFile(p, SNAPSHOT_FOLDER)
          : copyUploadPathToImports(p)
        : Promise.resolve(p)
    )
  );
}
