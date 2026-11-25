import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  deleteAgentMemoryFile,
  readAgentMemoryFile,
  resolveAgentMemoryFilePath,
  writeAgentMemoryFile,
} from "@/lib/admin/legacy-agent-data/memory-file";

const originalUploads = process.env.UPLOADS_DIR;
const roots: string[] = [];

afterEach(async () => {
  process.env.UPLOADS_DIR = originalUploads;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function useTempUploads() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-test-"));
  roots.push(root);
  process.env.UPLOADS_DIR = root;
  return root;
}

describe("private .Agent memory file", () => {
  it("resolves exactly one private file for a positive integer user id", async () => {
    const root = await useTempUploads();
    expect(resolveAgentMemoryFilePath(7)).toBe(path.join(root, ".agent-memory", "users", "7", ".Agent"));
    for (const invalid of [0, -1, 1.5, Number.NaN, "7"] as any[]) {
      expect(() => resolveAgentMemoryFilePath(invalid)).toThrow(/invalid Agent memory userId/);
    }
  });

  it("atomically writes a strict revisioned snapshot and validates reads", async () => {
    const root = await useTempUploads();
    const snapshot = {
      schemaVersion: 1 as const,
      userId: 7,
      revision: 2,
      updatedAt: "2026-08-30T12:00:00.000Z",
      memories: [{
        id: 3,
        type: "style" as const,
        key: "visual_style",
        value: "清新克制",
        confidence: 0.9,
        version: 1,
        sourceMessageId: 31,
        updatedAt: "2026-08-30T12:00:00.000Z",
      }],
    };
    await writeAgentMemoryFile(snapshot);
    await expect(readAgentMemoryFile(7, 2)).resolves.toEqual(snapshot);
    await expect(readAgentMemoryFile(7, 3)).rejects.toThrow(/revision/i);
    const mode = (await fs.stat(resolveAgentMemoryFilePath(7))).mode & 0o777;
    if (process.platform !== "win32") expect(mode).toBe(0o600);
    expect((await fs.readdir(path.join(root, ".agent-memory", "users", "7"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("deletes only the selected user's .Agent file", async () => {
    await useTempUploads();
    const snapshot = (userId: number) => ({
      schemaVersion: 1 as const,
      userId,
      revision: 1,
      updatedAt: "2026-08-30T12:00:00.000Z",
      memories: [],
    });
    await writeAgentMemoryFile(snapshot(7));
    await writeAgentMemoryFile(snapshot(8));
    await deleteAgentMemoryFile(7);
    await expect(fs.stat(resolveAgentMemoryFilePath(7))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(resolveAgentMemoryFilePath(8))).resolves.toBeTruthy();
  });
});
