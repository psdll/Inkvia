import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  root: "",
  userImportJob: {
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn().mockResolvedValue(undefined),
  },
  generation: {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    updateMany: vi.fn(),
  },
  raw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => {
  const models = {
    userImportJob: state.userImportJob,
    generation: state.generation,
    user: { findMany: vi.fn().mockResolvedValue([{ id: 52 }]) },
    $executeRawUnsafe: state.raw,
  };
  return { default: { ...models, $transaction: async (run: (tx: typeof models) => unknown) => run(models) } };
});
vi.mock("@/lib/public-path", () => ({
  resolvePublicDir: () => state.root,
  resolvePublicPath: (...segments: string[]) => path.join(state.root, ...segments),
}));
vi.mock("@/lib/admin/user-import-account", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/admin/user-import-account")>();
  const account = { sourceUserId: 41, targetUserId: 52, created: false };
  return { ...original, planImportedAccount: vi.fn().mockResolvedValue(account), restoreImportedAccount: vi.fn().mockResolvedValue(account) };
});
vi.mock("@/lib/admin-analytics-rollup", () => ({ rebuildRecentDailyAnalytics: vi.fn() }));

import { runUserImportJob } from "@/lib/admin/user-import-runner";

it("restores a regular generation and its files from a legacy archive with retired workspace records", async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), "inkvia-legacy-user-import-"));
  try {
    await fs.ensureDir(path.join(state.root, "uploads"));
    const filePath = path.join(state.root, "legacy.zip");
    const generation = {
      id: 7, authUserId: 41, userId: "41", type: "video_gen", source: "tool", status: "success",
      localPath: "/uploads/imports/normal.mp4", createdAt: "2026-01-01T00:00:00.000Z",
    };
    const zip = new ZipFile();
    const archive = pipeline(zip.outputStream, fs.createWriteStream(filePath));
    const add = (entry: string, data: unknown) => zip.addBuffer(Buffer.from(JSON.stringify(data)), `backup/${entry}`);
    add("manifest.json", { version: 1, stats: { generations: 1, virtualAvatars: 1, files: 2 } });
    add("data/user.json", { id: 41, username: "legacy" });
    add("data/generations.json", [generation]);
    add("data/virtual_avatars.json", [{ id: 1, ownerUserId: 41, sourceUrl: "/uploads/virtual_avatars/source.png" }]);
    zip.addBuffer(Buffer.from("ordinary output"), "backup/files/uploads/imports/normal.mp4");
    zip.addBuffer(Buffer.from("legacy archived media"), "backup/files/uploads/virtual_avatars/source.png");
    zip.end();
    await archive;
    state.userImportJob.findUnique.mockResolvedValue({ status: "pending", filePath, fileSize: (await fs.stat(filePath)).size });

    await runUserImportJob("legacy");

    expect(state.userImportJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "done" }) }));
    expect(state.generation.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ id: 7, authUserId: 52, localPath: generation.localPath })] });
    expect(await fs.readFile(path.join(state.root, "uploads/imports/normal.mp4"), "utf8")).toBe("ordinary output");
    expect(await fs.readFile(path.join(state.root, "uploads/virtual_avatars/source.png"), "utf8")).toBe("legacy archived media");
    expect(state.raw.mock.calls.flat().join(" ")).not.toContain("VirtualAvatar");
  } finally {
    await fs.remove(state.root);
  }
});
