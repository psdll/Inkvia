import "server-only";

import path from "node:path";
import { mkdir, open, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { z } from "zod";

import { resolveUploadsRootDirectory } from "@/lib/storage";

const MAX_AGENT_MEMORY_FILE_BYTES = 1024 * 1024;

const agentMemoryRecordSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(["platform", "business", "audience", "style", "preference", "constraint", "asset", "workflow"]),
  key: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(1200),
  confidence: z.number().min(0).max(1),
  version: z.number().int().positive(),
  sourceMessageId: z.number().int().positive().nullable().optional(),
  updatedAt: z.string().datetime(),
}).strict();

export const agentMemoryFileSchema = z.object({
  schemaVersion: z.literal(1),
  userId: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  memories: z.array(agentMemoryRecordSchema).max(200),
}).strict();

export type AgentMemoryFile = z.infer<typeof agentMemoryFileSchema>;

export class AgentMemoryFileConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentMemoryFileConsistencyError";
  }
}

function usersRoot() {
  return path.resolve(resolveUploadsRootDirectory(), ".agent-memory", "users");
}

export function resolveAgentMemoryFilePath(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("invalid Agent memory userId");
  }
  const root = usersRoot();
  const target = path.resolve(root, String(userId), ".Agent");
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("invalid Agent memory path");
  }
  return target;
}

export async function readAgentMemoryFile(userId: number, expectedRevision: number) {
  const filePath = resolveAgentMemoryFilePath(userId);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size > MAX_AGENT_MEMORY_FILE_BYTES) {
      throw new AgentMemoryFileConsistencyError("Agent memory file size is invalid");
    }
    const parsed = agentMemoryFileSchema.safeParse(JSON.parse(await readFile(filePath, "utf8")));
    if (!parsed.success) throw new AgentMemoryFileConsistencyError("Agent memory file schema is invalid");
    if (parsed.data.userId !== userId) throw new AgentMemoryFileConsistencyError("Agent memory userId mismatch");
    if (parsed.data.revision !== expectedRevision) throw new AgentMemoryFileConsistencyError("Agent memory revision mismatch");
    return parsed.data;
  } catch (error) {
    if (error instanceof AgentMemoryFileConsistencyError) throw error;
    throw new AgentMemoryFileConsistencyError("Agent memory file is unavailable");
  }
}

export async function writeAgentMemoryFile(input: AgentMemoryFile) {
  const snapshot = agentMemoryFileSchema.parse(input);
  const filePath = resolveAgentMemoryFilePath(snapshot.userId);
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.Agent.${crypto.randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
    return filePath;
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function deleteAgentMemoryFile(userId: number) {
  const filePath = resolveAgentMemoryFilePath(userId);
  await rm(filePath, { force: true });
  await rmdir(path.dirname(filePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
  });
}

export async function deleteAgentMemoryDirectoryForUser(userId: number) {
  return deleteAgentMemoryFile(userId);
}
