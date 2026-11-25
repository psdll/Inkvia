import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ZipFile } from "yazl";
import JSZip from "jszip";
import { pipeline } from "node:stream/promises";
import { encryptPassword } from "@/lib/password-crypto";
import { hashPassword } from "@/lib/password";
import { cleanupMigrationScratch, openMigrationCredential, sealMigrationCredential, unwrapMigrationArchive, validateMigrationPassphrase, wrapMigrationArchive } from "@/lib/admin/user-migration-package";

let dir: string;
const passphrase = "a migration passphrase 🔐";
async function zipFile(file: string, entries: Array<[string, Buffer | string]>) {
  const zip = new ZipFile();
  for (const [name, value] of entries) zip.addBuffer(Buffer.isBuffer(value) ? value : Buffer.from(value), name);
  const done = pipeline(zip.outputStream, fs.createWriteStream(file));
  zip.end();
  await done;
}
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-package-"));
  const keyFile = path.join(dir, "keys.json");
  await fs.writeFile(keyFile, JSON.stringify({ test: randomBytes(32).toString("base64") }));
  vi.stubEnv("PASSWORD_CIPHER_KEYRING_FILE", keyFile);
  vi.stubEnv("PASSWORD_CIPHER_ACTIVE_KEY_ID", "test");
});
afterAll(async () => { vi.unstubAllEnvs(); await fs.remove(dir); });

describe("migration package", () => {
  it("retains login hash and recoverable password without a source-server key on import", async () => {
    const plain = " 密码 with spaces 🔐 ";
    const hash = await hashPassword(plain);
    const sealed = await sealMigrationCredential({ id: 11, password: hash, passwordCipher: encryptPassword(plain, 11, 3), credentialVersion: 3 }, passphrase);
    expect(JSON.stringify(sealed)).not.toContain(plain);
    expect(await openMigrationCredential(sealed, passphrase)).toEqual({ version: 1, passwordHash: hash, recoverablePassword: plain });
    await expect(openMigrationCredential(sealed, "wrong passphrase!")).rejects.toThrow(/^MIGRATION_PASSPHRASE_INVALID/);
    const altered = { ...(sealed as object), authTag: randomBytes(16).toString("base64url") };
    await expect(openMigrationCredential(altered, passphrase)).rejects.toThrow(/^MIGRATION_PASSPHRASE_INVALID/);
  }, 20000);
  it("keeps hash-only accounts usable and rejects unbounded or unknown hashes", async () => {
    const hash = await hashPassword("hash-only-password");
    const sealed = await sealMigrationCredential({ id: 12, password: hash, passwordCipher: null, credentialVersion: 0 }, passphrase);
    expect(await openMigrationCredential(sealed, passphrase)).toEqual({ version: 1, passwordHash: hash });
    await expect(sealMigrationCredential({ id: 12, password: "$scrypt$v1$999999999$8$1$bad$bad", passwordCipher: null, credentialVersion: 0 }, passphrase)).rejects.toThrow("MIGRATION_CREDENTIAL_INVALID");
    await expect(sealMigrationCredential({ id: 12, password: hash, passwordCipher: { schemaVersion: 1 }, credentialVersion: 1 }, passphrase)).rejects.toThrow(/PASSWORD_CIPHER_INVALID/);
    expect(() => validateMigrationPassphrase(" short ")).toThrow();
  }, 20000);
  it("streams a V2 archive, authenticates before exposing plaintext, and preserves V1", async () => {
    const inner = path.join(dir, "inner.zip"), outer = path.join(dir, "outer.zip");
    await zipFile(inner, [["user_export_test/manifest.json", JSON.stringify({ version: 1 })], ["user_export_test/data/user.json", JSON.stringify({ id: 11, username: "private-name" })]]);
    const legacy = await unwrapMigrationArchive(inner);
    expect(legacy).toMatchObject({ filePath: inner, encrypted: false });
    const rootLegacy = path.join(dir, "root-legacy.zip");
    await zipFile(rootLegacy, [["manifest.json", JSON.stringify({ version: 1 })], ["data/user.json", "{}"], ["data/extra.json", "{}"]]);
    expect((await unwrapMigrationArchive(rootLegacy)).encrypted).toBe(false);
    await wrapMigrationArchive(inner, outer, passphrase);
    expect((await fs.readFile(outer)).includes(Buffer.from("private-name"))).toBe(false);
    await expect(unwrapMigrationArchive(outer)).rejects.toThrow(/^MIGRATION_PASSPHRASE_REQUIRED/);
    await expect(unwrapMigrationArchive(outer, "wrong passphrase!")).rejects.toThrow(/^MIGRATION_PASSPHRASE_INVALID/);
    const opened = await unwrapMigrationArchive(outer, passphrase);
    expect(opened.encrypted).toBe(true);
    expect(await fs.readFile(opened.filePath)).toEqual(await fs.readFile(inner));
    await opened.cleanup();
    expect(await fs.pathExists(opened.filePath)).toBe(false);
  }, 20000);
  it("retains every byte across many encrypted stream chunks", async () => {
    const source = path.join(dir, "chunked-source.zip"), outer = path.join(dir, "chunked-outer.zip");
    const content = randomBytes(3 * 1024 * 1024);
    await zipFile(source, [["manifest.json", JSON.stringify({ version: 1 })], ["files/random.bin", content]]);
    await wrapMigrationArchive(source, outer, passphrase);
    const opened = await unwrapMigrationArchive(outer, passphrase);
    try { expect(await fs.readFile(opened.filePath)).toEqual(await fs.readFile(source)); }
    finally { await opened.cleanup(); }
  }, 20000);
  it("rejects future format and oversized metadata", async () => {
    const future = path.join(dir, "future.zip");
    await zipFile(future, [["manifest.json", JSON.stringify({ version: 99 })]]);
    await expect(unwrapMigrationArchive(future, passphrase)).rejects.toThrow(/请升级应用/);
    const oversized = path.join(dir, "oversized.zip");
    await zipFile(oversized, [["manifest.json", "x".repeat(4097)]]);
    await expect(unwrapMigrationArchive(oversized, passphrase)).rejects.toThrow(/清单过大/);
    const valid = path.join(dir, "valid-for-kdf.zip"), badKdf = path.join(dir, "bad-kdf.zip");
    const source = path.join(dir, "inner.zip");
    await wrapMigrationArchive(source, valid, passphrase);
    const zip = await JSZip.loadAsync(await fs.readFile(valid));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    manifest.kdf.N = 2 ** 30;
    zip.file("manifest.json", JSON.stringify(manifest));
    await fs.writeFile(badKdf, await zip.generateAsync({ type: "nodebuffer" }));
    await expect(unwrapMigrationArchive(badKdf, passphrase)).rejects.toThrow(/清单参数无效/);
    const tampered = path.join(dir, "tampered-payload.zip");
    const tamperZip = await JSZip.loadAsync(await fs.readFile(valid));
    const payload = await tamperZip.file("payload.enc")!.async("nodebuffer");
    payload[0] ^= 1;
    tamperZip.file("payload.enc", payload, { compression: "STORE" });
    await fs.writeFile(tampered, await tamperZip.generateAsync({ type: "nodebuffer" }));
    await expect(unwrapMigrationArchive(tampered, passphrase)).rejects.toThrow(/^MIGRATION_PASSPHRASE_INVALID/);
  });
  it("opens a portable V3 package without input and rejects damaged embedded keys", async () => {
    const source = path.join(dir, "portable-source.zip"), outer = path.join(dir, "portable.zip");
    const key = randomBytes(32).toString("base64url");
    await zipFile(source, [["manifest.json", JSON.stringify({ version: 1 })], ["data/user.json", "{}"]]);
    await wrapMigrationArchive(source, outer, key, true);
    const opened = await unwrapMigrationArchive(outer);
    try {
      expect(opened.credentialKey).toBe(key);
      expect(await fs.readFile(opened.filePath)).toEqual(await fs.readFile(source));
    } finally { await opened.cleanup(); }
    const zip = await JSZip.loadAsync(await fs.readFile(outer));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.version).toBe(3);
    manifest.portableKey = randomBytes(32).toString("base64url");
    zip.file("manifest.json", JSON.stringify(manifest));
    await fs.writeFile(outer, await zip.generateAsync({ type: "nodebuffer" }));
    await expect(unwrapMigrationArchive(outer)).rejects.toThrow(/^MIGRATION_PACKAGE_INVALID: 归档已损坏/);
  });
  it("cleans only old owned scratch directories", async () => {
    const root = path.join(dir, "scratch-cleanup");
    await fs.ensureDir(root);
    const old = path.join(root, ".migration-build-ABC123");
    const recent = path.join(root, ".migration-open-DEF456");
    const unrelated = path.join(root, ".migration-build-TOO-LONG");
    const target = path.join(root, "original");
    const link = path.join(root, ".migration-GHI789");
    for (const item of [old, recent, unrelated, target]) await fs.ensureDir(item);
    await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    const now = Date.now();
    const stale = new Date(now - 25 * 60 * 60 * 1000);
    await fs.utimes(old, stale, stale);
    expect(await cleanupMigrationScratch(root, now)).toBe(1);
    expect(await fs.pathExists(old)).toBe(false);
    for (const item of [recent, unrelated, target, link]) expect(await fs.pathExists(item)).toBe(true);
  });
});
