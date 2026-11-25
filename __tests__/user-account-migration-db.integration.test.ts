import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { verifyPassword, hashPassword } from "@/lib/password";
import { decryptPassword } from "@/lib/password-crypto";

const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;
const prefix = `migration-${randomUUID().slice(0, 8)}`;
const usernames: string[] = [];
const jobIds: string[] = [];
const exportJobIds: string[] = [];
let db: any;
async function client() { return db ||= (await import("@/lib/prisma")).default; }
async function archive(username: string, generations: any[] = [], extra: Record<string, unknown> = {}) {
  usernames.push(username);
  const id = randomUUID();
  const filePath = path.join(process.env.IMPORTS_DIR!, `${prefix}-${id}.zip`);
  const zip = new ZipFile();
  const completion = pipeline(zip.outputStream, fs.createWriteStream(filePath));
  zip.addBuffer(Buffer.from(JSON.stringify({ version: 1, stats: { generations: generations.length, files: 1 } })), "backup/manifest.json");
  zip.addBuffer(Buffer.from(JSON.stringify({ id: 87654, username, ...extra })), "backup/data/user.json");
  zip.addBuffer(Buffer.from(JSON.stringify(generations)), "backup/data/generations.json");
  zip.addBuffer(Buffer.from("synthetic file"), `backup/files/uploads/${prefix}/${username}.txt`);
  zip.end(); await completion;
  return filePath;
}
async function run(filePath: string, options: any = {}) {
  const p = await client();
  const job = await p.userImportJob.create({ data: { filePath, fileName: path.basename(filePath), fileSize: BigInt((await fs.stat(filePath)).size) } });
  jobIds.push(job.id);
  const { runUserImportJob } = await import("@/lib/admin/user-import-runner");
  await runUserImportJob(job.id, options);
  return p.userImportJob.findUniqueOrThrow({ where: { id: job.id } });
}
afterAll(async () => {
  if (!db) return;
  const users = await db.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
  await db.generation.deleteMany({ where: { authUserId: { in: users.map((u: any) => u.id) } } });
  await db.user.deleteMany({ where: { username: { in: usernames } } });
  await db.userImportJob.deleteMany({ where: { id: { in: jobIds } } });
  await db.userExportJob.deleteMany({ where: { id: { in: exportJobIds } } });
  await fs.remove(path.join(process.env.UPLOADS_DIR!, prefix));
  for (const name of await fs.readdir(process.env.IMPORTS_DIR!)) {
    if (name.startsWith(`${prefix}-`)) await fs.remove(path.join(process.env.IMPORTS_DIR!, name));
  }
  await db.$disconnect();
});
describe("isolated PostgreSQL account migration release gate", () => {
  integration("imports a legacy archive and repeat without registration or extra input", async () => {
    const name = `${prefix}-legacy`;
    const generation = { id: 912345, userId: "87654", authUserId: 87654, type: "image_edit", source: "tool", prompt: "fixture", status: "success", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const file = await archive(name, [generation], { password: "injected", token: "injected" });
    let job = await run(file);
    expect(job.error).toBeNull(); expect(job.status).toBe("done");
    const user = await db.user.findUniqueOrThrow({ where: { username: name } });
    expect(user.id).not.toBe(87654);
    const generated = decryptPassword(user.passwordCipher, user.id, user.credentialVersion);
    expect(await verifyPassword(generated, user.password)).toBe(true);
    expect(generated).not.toBe("injected");
    expect(JSON.parse(job.stats).warnings.join(" ")).toContain("自动生成新密码");
    expect(user.token).toBeNull();
    expect(await db.generation.count({ where: { authUserId: user.id } })).toBe(1);
    const repeated = await archive(name, [generation]);
    job = await run(repeated);
    expect(job.error).toBeNull(); expect(job.status).toBe("done");
    expect(await db.generation.count({ where: { authUserId: user.id } })).toBe(1);
    const retained = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(retained.password).toBe(user.password);
    expect(retained.passwordCipher).toEqual(user.passwordCipher);
  }, 30000);

  integration("rolls back new account and extracted files when a later data write fails", async () => {
    const name = `${prefix}-rollback`;
    const file = await archive(name, [{ id: 912346, authUserId: 87654, type: "image_edit", status: "success" }]);
    const job = await run(file, { newPassword: "fixture-password" });
    expect(job.status).toBe("error");
    expect(await db.user.findUnique({ where: { username: name } })).toBeNull();
    expect(await fs.pathExists(path.join(process.env.UPLOADS_DIR!, prefix, `${name}.txt`))).toBe(false);
    expect(await fs.pathExists(file)).toBe(true);
    expect(job.error).not.toContain("fixture-password");
  }, 30000);

  integration("round-trips the actual portable export with no password input under a new user ID", async () => {
    const p = await client();
    const { createUserCredential, preparePasswordVerification } = await import("@/lib/user-credentials");
    const { runUserExportJob } = await import("@/lib/admin/user-export-runner");
    const { DEFAULT_EXPORT_OPTIONS } = await import("@/lib/admin/user-export-builder");
    const name = `${prefix}-roundtrip`;
    const moved = `${name}-source`;
    usernames.push(name, moved);
    const prepared = await preparePasswordVerification("source-password");
    const source = await p.$transaction((tx: any) => createUserCredential(tx, { username: name, prepared }));
    const sourceRow = await p.user.findUniqueOrThrow({ where: { id: source.id } });
    const options = { ...DEFAULT_EXPORT_OPTIONS, archiveMode: "portable" };
    const exportJob = await p.userExportJob.create({ data: { userId: String(source.id), authUserId: source.id, options: JSON.stringify(options) } });
    exportJobIds.push(exportJob.id);
    await runUserExportJob(exportJob.id);
    const exported = await p.userExportJob.findUniqueOrThrow({ where: { id: exportJob.id } });
    expect(exported.error).toBeNull(); expect(exported.status).toBe("done");
    expect(exported.options).not.toContain("portableKey");
    const importedPath = path.join(process.env.IMPORTS_DIR!, `${prefix}-roundtrip.zip`);
    await fs.copy(exported.filePath, importedPath);
    await fs.remove(exported.filePath);
    await p.user.update({ where: { id: source.id }, data: { username: moved } });
    const job = await run(importedPath);
    expect(job.error).toBeNull(); expect(job.status).toBe("done");
    const restored = await p.user.findUniqueOrThrow({ where: { username: name } });
    expect(restored.id).not.toBe(source.id);
    expect(await verifyPassword("source-password", restored.password)).toBe(true);
    expect(decryptPassword(restored.passwordCipher, restored.id, restored.credentialVersion)).toBe("source-password");
    expect(restored.passwordCipher).not.toEqual(sourceRow.passwordCipher);
    expect(restored.token).toBeNull();
  }, 30000);

  integration("recovers stale pending jobs without replaying secrets and preserves the uploaded original", async () => {
    const p = await client();
    const { runUserExportMaintenance } = await import("@/lib/admin/user-export-maintenance");
    const file = await archive(`${prefix}-interrupted`);
    const stale = new Date(Date.now() - 31 * 60 * 1000);
    const job = await p.userImportJob.create({ data: { filePath: file, status: "pending", updatedAt: stale } });
    jobIds.push(job.id);
    const exported = await p.userExportJob.create({ data: {
      userId: "synthetic", status: "pending", options: JSON.stringify({ archiveMode: "migration" }), updatedAt: stale,
    } });
    exportJobIds.push(exported.id);
    const scratch = path.join(process.env.IMPORTS_DIR!, ".migration-open-Ab12Cd");
    await fs.ensureDir(scratch);
    await fs.writeFile(path.join(scratch, "payload.zip"), "old scratch");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(scratch, old, old);
    await runUserExportMaintenance();
    expect((await p.userImportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("error");
    expect((await p.userExportJob.findUniqueOrThrow({ where: { id: exported.id } })).status).toBe("error");
    expect(await fs.pathExists(file)).toBe(true);
    expect(await fs.pathExists(scratch)).toBe(false);
  }, 30000);

  integration("authenticates a V2 package before mutation and restores same-password login", async () => {
    const { sealMigrationCredential, wrapMigrationArchive } = await import("@/lib/admin/user-migration-package");
    const name = `${prefix}-encrypted`;
    const passphrase = "synthetic-transfer-passphrase";
    const hash = await hashPassword("original-password");
    const credential = await sealMigrationCredential({ id: 87654, password: hash, passwordCipher: null, credentialVersion: 1 }, passphrase);
    const inner = await archive(name, [], { migrationCredential: credential });
    const outer = path.join(process.env.IMPORTS_DIR!, `${prefix}-encrypted.zip`);
    await wrapMigrationArchive(inner, outer, passphrase);
    let job = await run(outer);
    expect(JSON.parse(job.stats).needsInput.kind).toBe("passphrase");
    job = await run(outer, { migrationPassphrase: "incorrect-passphrase" });
    expect(job.status).toBe("error");
    expect(await db.user.findUnique({ where: { username: name } })).toBeNull();
    job = await run(outer, { migrationPassphrase: passphrase });
    expect(job.error).toBeNull(); expect(job.status).toBe("done");
    const user = await db.user.findUniqueOrThrow({ where: { username: name } });
    expect(await verifyPassword("original-password", user.password)).toBe(true);
    expect(user.token).toBeNull();
    expect(JSON.parse(job.stats).warnings.join(" ")).toContain("哈希");
  }, 30000);
});
