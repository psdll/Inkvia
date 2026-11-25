import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "@/lib/password";
import { decryptPassword, encryptPassword } from "@/lib/password-crypto";
import { revealUserCredential, verifyUserCredential } from "@/lib/user-credentials";

let directory: string;
let keyFile: string;
const keys = { first: randomBytes(32).toString("base64"), second: randomBytes(32).toString("base64") };
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "p0-password-")); keyFile = path.join(directory, "keys.json");
  fs.writeFileSync(keyFile, JSON.stringify(keys));
  vi.stubEnv("PASSWORD_CIPHER_KEYRING_FILE", keyFile); vi.stubEnv("PASSWORD_CIPHER_ACTIVE_KEY_ID", "first");
});
afterAll(() => { vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("versioned password verification and authenticated copies", () => {
  it.each([" 空格 密码 🔐 ", "x".repeat(256), "中文".repeat(80), "line\n\t$<&\\\"'"])("preserves exact Unicode and long input (%#)", async plain => {
    const hash = await hashPassword(plain);
    expect(hash).not.toContain(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
    expect(await verifyPassword(`${plain.slice(0, -1)}!`, hash)).toBe(false);
    expect(decryptPassword(encryptPassword(plain, 11, 2), 11, 2)).toBe(plain);
  }, 15000);
  it("rejects malformed hashes and unapproved expensive parameters before computing", async () => {
    expect(await verifyPassword("anything", "$scrypt$v1$999999999$8$1$salt$hash")).toBe(false);
    expect(await verifyPassword("$scrypt$broken", "$scrypt$broken")).toBe(false);
  });
  it("does not release modified, cross-user, cross-version or unauthenticated ciphertext", () => {
    const cipher = encryptPassword("synthetic-secret", 11, 2);
    for (const value of [{ ...cipher, nonce: randomBytes(12).toString("base64") }, { ...cipher, authTag: randomBytes(16).toString("base64") }, { ...cipher, ciphertext: Buffer.from("tampered").toString("base64") }]) expect(() => decryptPassword(value, 11, 2)).toThrow("PASSWORD_CIPHER_INVALID");
    expect(() => decryptPassword(cipher, 12, 2)).toThrow("PASSWORD_CIPHER_INVALID");
    expect(() => decryptPassword(cipher, 11, 3)).toThrow("PASSWORD_CIPHER_INVALID");
    expect(() => decryptPassword({ ...cipher, keyId: "missing" }, 11, 2)).toThrow("PASSWORD_CIPHER_KEY_UNAVAILABLE");
  });
  it("retains old-key readability across rotation and separate key restoration", () => {
    const before = encryptPassword("synthetic-secret", 11, 2);
    vi.stubEnv("PASSWORD_CIPHER_ACTIVE_KEY_ID", "second");
    const after = encryptPassword(decryptPassword(before, 11, 2), 11, 2);
    expect(after.keyId).toBe("second");
    fs.writeFileSync(keyFile, JSON.stringify({ second: keys.second }));
    expect(decryptPassword(after, 11, 2)).toBe("synthetic-secret");
    expect(() => decryptPassword(before, 11, 2)).toThrow("PASSWORD_CIPHER_KEY_UNAVAILABLE");
    fs.writeFileSync(keyFile, JSON.stringify(keys));
    expect(decryptPassword(before, 11, 2)).toBe("synthetic-secret");
    vi.stubEnv("PASSWORD_CIPHER_ACTIVE_KEY_ID", "first");
  });
  it("keeps legacy bcrypt login without claiming recovery of ambiguous long passwords", async () => {
    const plain = "a".repeat(72) + "original-suffix";
    const password = await bcrypt.hash(plain, 4);
    const user = { id: 11, credentialVersion: 0, passwordCipher: null, password };
    expect(await verifyUserCredential(user, "a".repeat(72) + "other-suffix")).toEqual({ valid: true, upgradeAllowed: false });
    expect(() => revealUserCredential(user)).toThrow("PASSWORD_LEGACY_HASH_ONLY");
    expect(revealUserCredential({ ...user, password: " legacy plain " })).toBe(" legacy plain ");
  });
});
