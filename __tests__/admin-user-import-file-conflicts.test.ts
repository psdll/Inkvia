import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("user import physical file conflicts", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "user-import-conflict-"));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("reuses an existing file only when the full content is identical", async () => {
    const files = await import("@/lib/admin/user-import-files");
    const target = path.join(tempDir, "same.png");
    await fs.writeFile(target, "same-content");

    await expect(files.classifyImportTarget({
      targetPath: target,
      expectedSize: Buffer.byteLength("same-content"),
      openArchiveStream: async () => Readable.from([Buffer.from("same-content")]),
    })).resolves.toBe("reuse");

    await expect(files.classifyImportTarget({
      targetPath: target,
      expectedSize: Buffer.byteLength("same-content"),
      openArchiveStream: async () => Readable.from([Buffer.from("other-content")]),
    })).resolves.toBe("conflict");
  });

  it("marks a missing target for exclusive restore", async () => {
    const files = await import("@/lib/admin/user-import-files");
    const target = path.join(tempDir, "missing.png");

    await expect(files.classifyImportTarget({
      targetPath: target,
      expectedSize: 3,
      openArchiveStream: async () => Readable.from([Buffer.from("new")]),
    })).resolves.toBe("create");
  });

  it("never deletes a file that appears between preflight and exclusive creation", async () => {
    const files = await import("@/lib/admin/user-import-files");
    const target = path.join(tempDir, "raced.png");
    await fs.writeFile(target, "local-wins");

    await expect(files.openExclusiveImportTarget(target)).rejects.toMatchObject({
      conflicts: [target.replace(/\\/g, "/")],
    });
    expect(await fs.readFile(target, "utf8")).toBe("local-wins");
  });

  it("preflights file conflicts before the database transaction", () => {
    const runner = fs.readFileSync(path.resolve(process.cwd(), "lib/admin/user-import-runner.ts"), "utf8");
    const preflight = runner.indexOf("preflightImportFiles(");
    const transaction = runner.indexOf("prisma.$transaction(");

    expect(preflight).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(preflight);
    expect(runner).toContain("FileConflictError");
    expect(runner).toContain("conflicts: err.conflicts");
  });
});
