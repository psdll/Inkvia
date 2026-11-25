import crypto from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import fs from "fs-extra";

export class FileConflictError extends Error {
  readonly conflicts: string[];

  constructor(conflicts: string[]) {
    super(`发现 ${conflicts.length} 个同路径不同内容的冲突文件，导入已停止`);
    this.name = "FileConflictError";
    this.conflicts = conflicts;
  }
}

async function hashStream(stream: AsyncIterable<Uint8Array | string>) {
  const hash = crypto.createHash("sha256");
  for await (const value of stream) hash.update(typeof value === "string" ? Buffer.from(value) : value);
  return hash.digest("hex");
}

export function openExclusiveImportTarget(targetPath: string): Promise<WriteStream> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(targetPath, { flags: "wx" });
    const onError = (error: Error) => {
      output.off("open", onOpen);
      const code = (error as NodeJS.ErrnoException).code;
      reject(code === "EEXIST"
        ? new FileConflictError([targetPath.replace(/\\/g, "/")])
        : error);
    };
    const onOpen = () => {
      output.off("error", onError);
      resolve(output);
    };
    output.once("error", onError);
    output.once("open", onOpen);
  });
}

export async function classifyImportTarget(params: {
  targetPath: string;
  expectedSize: number;
  openArchiveStream: () => Promise<AsyncIterable<Uint8Array | string>>;
}): Promise<"create" | "reuse" | "conflict"> {
  const stat = await fs.stat(params.targetPath).catch(() => null);
  if (!stat?.isFile()) return "create";
  if (Number(stat.size) !== Number(params.expectedSize)) return "conflict";
  const [diskHash, archiveHash] = await Promise.all([
    hashStream(createReadStream(params.targetPath)),
    params.openArchiveStream().then(hashStream),
  ]);
  return diskHash === archiveHash ? "reuse" : "conflict";
}
