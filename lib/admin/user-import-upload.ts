import crypto from "node:crypto";
import path from "node:path";
import { open, truncate } from "node:fs/promises";
import fs from "fs-extra";
import { assertDiskSpace, formatBytes, getMaxImportBytes } from "@/lib/admin/user-transfer-limits";
import { getImportsDir } from "@/lib/admin/user-transfer-paths";

export const IMPORT_UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;
export const IMPORT_UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type StoredImportUploadSession = {
  uploadId: string;
  fileName: string;
  fileSize: number;
  receivedBytes: number;
  partPath: string;
  finalPath: string;
  createdAt: string;
  updatedAt: string;
  jobId?: string;
};

export type ImportUploadSession = StoredImportUploadSession & {
  chunkBytes: number;
  maxImportBytes: number;
};

const uploadLocks = new Map<string, Promise<unknown>>();

function sessionDir() {
  return path.join(getImportsDir(), ".upload-sessions");
}

function assertUploadId(uploadId: string) {
  if (!/^[a-f0-9]{32}$/.test(uploadId)) throw new Error("上传会话 ID 无效");
}

function sessionPath(uploadId: string) {
  assertUploadId(uploadId);
  return path.join(sessionDir(), `${uploadId}.json`);
}

function publicSession(session: StoredImportUploadSession): ImportUploadSession {
  return {
    ...session,
    chunkBytes: IMPORT_UPLOAD_CHUNK_BYTES,
    maxImportBytes: getMaxImportBytes(),
  };
}

async function readSession(uploadId: string): Promise<StoredImportUploadSession> {
  const session = await fs.readJson(sessionPath(uploadId)).catch(() => null) as StoredImportUploadSession | null;
  if (!session || session.uploadId !== uploadId) throw new Error("上传会话不存在或已过期");
  return session;
}

async function writeSession(session: StoredImportUploadSession) {
  await fs.ensureDir(sessionDir());
  const target = sessionPath(session.uploadId);
  const temporary = `${target}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeJson(temporary, session);
  await fs.move(temporary, target, { overwrite: true });
}

async function cleanupExpiredUploadSessions() {
  await fs.ensureDir(sessionDir());
  const cutoff = Date.now() - IMPORT_UPLOAD_SESSION_TTL_MS;
  const names = await fs.readdir(sessionDir()).catch(() => [] as string[]);
  for (const name of names) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
    const metadataPath = path.join(sessionDir(), name);
    const session = await fs.readJson(metadataPath).catch(() => null) as StoredImportUploadSession | null;
    const updatedAt = session ? new Date(session.updatedAt).getTime() : 0;
    if (Number.isFinite(updatedAt) && updatedAt >= cutoff) continue;
    if (session && !session.jobId && !await fs.pathExists(session.finalPath)) {
      await fs.remove(session.partPath).catch(() => {});
    }
    await fs.remove(metadataPath).catch(() => {});
  }
}

async function withUploadLock<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
  const previous = uploadLocks.get(uploadId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => {}).then(() => current);
  uploadLocks.set(uploadId, queued);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (uploadLocks.get(uploadId) === queued) uploadLocks.delete(uploadId);
  }
}

function normalizeZipName(fileName: string) {
  const base = path.basename(String(fileName || "").trim());
  if (!base || path.extname(base).toLowerCase() !== ".zip") throw new Error("只能导入 ZIP 文件");
  return base.slice(0, 240);
}

export async function beginImportUpload(params: {
  fileName: string;
  fileSize: number;
  uploadId?: string | null;
}): Promise<ImportUploadSession> {
  await cleanupExpiredUploadSessions();
  const fileName = normalizeZipName(params.fileName);
  const fileSize = Number(params.fileSize);
  const maxBytes = getMaxImportBytes();
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) throw new Error("导入文件大小无效");
  if (fileSize > maxBytes) throw new Error(`导入包超过上限 ${formatBytes(maxBytes)}`);

  const requestedId = String(params.uploadId || "").trim();
  if (requestedId && /^[a-f0-9]{32}$/.test(requestedId)) {
    const existing = await fs.readJson(sessionPath(requestedId)).catch(() => null) as StoredImportUploadSession | null;
    if (existing) {
      if (existing.fileName !== fileName || existing.fileSize !== fileSize) {
        throw new Error("上传会话与所选文件不匹配");
      }
      return publicSession(existing);
    }
  }

  const uploadId = crypto.randomBytes(16).toString("hex");
  const importsDir = getImportsDir();
  await fs.ensureDir(importsDir);
  await assertDiskSpace(importsDir, fileSize, "导入上传");
  const now = new Date().toISOString();
  const session: StoredImportUploadSession = {
    uploadId,
    fileName,
    fileSize,
    receivedBytes: 0,
    partPath: path.join(importsDir, `${uploadId}.part`),
    finalPath: path.join(importsDir, `${uploadId}.zip`),
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(session.partPath, Buffer.alloc(0), { flag: "wx" });
  await writeSession(session);
  return publicSession(session);
}

export async function writeImportUploadChunk(params: {
  uploadId: string;
  offset: number;
  contentLength: number;
  body: AsyncIterable<Uint8Array | string>;
}): Promise<ImportUploadSession> {
  const uploadId = String(params.uploadId || "").trim();
  assertUploadId(uploadId);
  return withUploadLock(uploadId, async () => {
    const session = await readSession(uploadId);
    if (session.jobId || await fs.pathExists(session.finalPath)) throw new Error("上传已经完成");
    if (params.offset !== session.receivedBytes) {
      throw new Error(`上传偏移不一致：服务端=${session.receivedBytes}，客户端=${params.offset}`);
    }
    const remaining = session.fileSize - session.receivedBytes;
    const contentLength = Number(params.contentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw new Error("上传分片大小无效");
    if (contentLength > IMPORT_UPLOAD_CHUNK_BYTES || contentLength > remaining) {
      throw new Error("上传分片超过允许大小");
    }

    const handle = await open(session.partPath, "r+");
    let received = 0;
    try {
      for await (const value of params.body) {
        const chunk = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
        if (received + chunk.length > contentLength) throw new Error("上传分片字节数超过声明大小");
        await handle.write(chunk, 0, chunk.length, session.receivedBytes + received);
        received += chunk.length;
      }
      if (received !== contentLength) throw new Error(`上传分片不完整：期望 ${contentLength}，实际 ${received}`);
    } catch (error) {
      await handle.close().catch(() => {});
      await truncate(session.partPath, session.receivedBytes).catch(() => {});
      throw error;
    }
    await handle.close();

    session.receivedBytes += received;
    session.updatedAt = new Date().toISOString();
    await writeSession(session);
    return publicSession(session);
  });
}

export async function finalizeImportUpload(uploadId: string) {
  assertUploadId(uploadId);
  return withUploadLock(uploadId, async () => {
    const session = await readSession(uploadId);
    if (await fs.pathExists(session.finalPath)) {
      const stat = await fs.stat(session.finalPath);
      if (stat.size !== session.fileSize) throw new Error("已完成的上传文件大小不一致");
      return { ...publicSession(session), filePath: session.finalPath };
    }
    if (session.receivedBytes !== session.fileSize) {
      throw new Error(`上传尚未完成：${session.receivedBytes}/${session.fileSize}`);
    }
    const stat = await fs.stat(session.partPath);
    if (stat.size !== session.fileSize) throw new Error("上传文件大小校验失败");
    await fs.move(session.partPath, session.finalPath, { overwrite: false });
    session.updatedAt = new Date().toISOString();
    await writeSession(session);
    return { ...publicSession(session), filePath: session.finalPath };
  });
}

export async function attachImportUploadJob(uploadId: string, jobId: string) {
  return withUploadLock(uploadId, async () => {
    const session = await readSession(uploadId);
    session.jobId = jobId;
    session.updatedAt = new Date().toISOString();
    await writeSession(session);
    return publicSession(session);
  });
}
