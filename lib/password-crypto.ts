import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export type PasswordCipherV1 = {
  schemaVersion: 1;
  algorithm: "aes-256-gcm";
  keyId: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
};

export class CredentialError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CredentialError"; }
}

function decode(value: unknown, length?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new CredentialError("PASSWORD_CIPHER_INVALID");
  const result = Buffer.from(value, "base64");
  if (result.toString("base64") !== value || (length !== undefined && result.length !== length)) throw new CredentialError("PASSWORD_CIPHER_INVALID");
  return result;
}

function readKey(keyId: string): Buffer {
  try {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error();
    const file = process.env.PASSWORD_CIPHER_KEYRING_FILE;
    if (!file) throw new Error();
    const keys: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) throw new Error();
    const encoded = (keys as Record<string, unknown>)[keyId];
    const key = decode(encoded, 32);
    if (encoded === process.env.ADMIN_SECRET || key.toString("utf8") === process.env.ADMIN_SECRET) throw new Error();
    return key;
  } catch { throw new CredentialError("PASSWORD_CIPHER_KEY_UNAVAILABLE"); }
}

export function assertPasswordCipherReady(): void {
  readKey(process.env.PASSWORD_CIPHER_ACTIVE_KEY_ID || "");
}

function aad(userId: number, credentialVersion: number): Buffer {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(credentialVersion) || credentialVersion < 1) throw new CredentialError("CREDENTIAL_VERSION_INVALID");
  return Buffer.from(JSON.stringify(["inkvia:user-password", userId, credentialVersion, 1]), "utf8");
}

export function encryptPassword(plain: string, userId: number, credentialVersion: number): PasswordCipherV1 {
  const keyId = process.env.PASSWORD_CIPHER_ACTIVE_KEY_ID || "";
  const key = readKey(keyId);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad(userId, credentialVersion));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { schemaVersion: 1, algorithm: "aes-256-gcm", keyId, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptPassword(value: unknown, userId: number, credentialVersion: number): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CredentialError("PASSWORD_CIPHER_INVALID");
  const data = value as Partial<PasswordCipherV1>;
  if (data.schemaVersion !== 1 || data.algorithm !== "aes-256-gcm" || typeof data.keyId !== "string") throw new CredentialError("PASSWORD_CIPHER_INVALID");
  const key = readKey(data.keyId);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, decode(data.nonce, 12), { authTagLength: 16 });
    decipher.setAAD(aad(userId, credentialVersion));
    decipher.setAuthTag(decode(data.authTag, 16));
    const ciphertext = decode(data.ciphertext);
    if (ciphertext.length > 4096) throw new Error();
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch { throw new CredentialError("PASSWORD_CIPHER_INVALID"); }
}
