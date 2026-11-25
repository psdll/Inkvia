import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/password";
import { decryptPassword } from "@/lib/password-crypto";
import { planImportedAccount, restoreImportedAccount } from "@/lib/admin/user-import-account";

let dir: string;
let hash: string;
const archived = { id: 89, username: "迁移用户", password: "injected", token: "injected" };
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "migration-account-test-"));
  await writeFile(path.join(dir, "keys.json"), JSON.stringify({ test: randomBytes(32).toString("base64") }));
  vi.stubEnv("PASSWORD_CIPHER_KEYRING_FILE", path.join(dir, "keys.json"));
  vi.stubEnv("PASSWORD_CIPHER_ACTIVE_KEY_ID", "test");
  hash = await hashPassword("original-password");
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
function client(existing: any = null) {
  return {
    user: { findUnique: vi.fn(async () => existing), create: vi.fn(async ({ data }: any) => data) },
    $queryRawUnsafe: vi.fn(async () => [{ id: 100 }]),
  };
}
describe("explicit administrator account migration", () => {
  it("automatically creates a password for a legacy archive and ignores injected credentials", async () => {
    const db = client();
    const plan = await planImportedAccount(db, archived, {});
    expect(plan.generatedPassword).toBe(true);
    await restoreImportedAccount(db, plan);
    const data = db.user.create.mock.calls[0][0].data;
    const generated = decryptPassword(data.passwordCipher, 100, 1);
    expect(generated.length).toBeGreaterThanOrEqual(20);
    expect(generated).not.toBe("injected");
    expect(await verifyPassword(generated, data.password)).toBe(true);
    expect(data.token).toBeNull();
  });
  it("creates legacy accounts with explicit new credentials and no source token", async () => {
    const db = client();
    const plan = await planImportedAccount(db, archived, { newPassword: "new-password" });
    const result = await restoreImportedAccount(db, plan);
    const data = db.user.create.mock.calls[0][0].data;
    expect(result).toMatchObject({ sourceUserId: 89, targetUserId: 100, created: true });
    expect(await verifyPassword("new-password", data.password)).toBe(true);
    expect(data.token).toBeNull();
    expect(decryptPassword(data.passwordCipher, 100, 1)).toBe("new-password");
  });
  it("automatically merges same-name accounts without replacing credentials", async () => {
    const db = client({ id: 12, username: archived.username, password: "target-hash" });
    const plan = await planImportedAccount(db, archived, {});
    expect(await restoreImportedAccount(db, plan)).toMatchObject({ targetUserId: 12, created: false });
    await expect(planImportedAccount(db, archived, { mergeTargetUserId: 13 })).rejects.toThrow(/变化/);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it("preserves original login and re-encrypts a recovered password for the target identity", async () => {
    const db = client();
    const plan = await planImportedAccount(db, archived, {}, { version: 1, passwordHash: hash, recoverablePassword: "original-password" });
    await restoreImportedAccount(db, plan);
    const data = db.user.create.mock.calls[0][0].data;
    expect(data.password).toBe(hash);
    expect(decryptPassword(data.passwordCipher, 100, 1)).toBe("original-password");
    expect(data.token).toBeNull();
  });
  it("allows hash-only migration without requiring a source password encryption key", async () => {
    const db = client();
    const plan = await planImportedAccount(db, archived, {}, { version: 1, passwordHash: hash });
    await restoreImportedAccount(db, plan);
    const data = db.user.create.mock.calls[0][0].data;
    expect(data.password).toBe(hash);
    expect(data.passwordCipher).toBeUndefined();
  });
  it("refuses account identity changes between preflight and transaction", async () => {
    const db = client();
    const plan = await planImportedAccount(db, archived, { newPassword: "new-password" });
    db.user.findUnique.mockResolvedValue({ id: 101, username: archived.username });
    await expect(restoreImportedAccount(db, plan)).rejects.toThrow(/变化/);
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it("does not recreate an account removed after merge confirmation", async () => {
    const db = client({ id: 12, username: archived.username });
    const plan = await planImportedAccount(db, archived, { mergeTargetUserId: 12 });
    db.user.findUnique.mockResolvedValue(null);
    await expect(restoreImportedAccount(db, plan)).rejects.toThrow(/变化/);
    expect(db.user.create).not.toHaveBeenCalled();
  });
});
