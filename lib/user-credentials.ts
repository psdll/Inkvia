import "server-only";
import { Prisma } from "@prisma/client";
import { hashPassword, isCurrentPasswordHash, isHashed, isLegacyBcrypt, verifyPassword } from "@/lib/password";
import { assertPasswordCipherReady, CredentialError, decryptPassword, encryptPassword } from "@/lib/password-crypto";

export type CredentialRecord = { id: number; password: string; passwordCipher: unknown; credentialVersion: number };
export type PreparedVerification = Readonly<{ hash: string; plain: string }>;
export async function preparePasswordVerification(plain: string): Promise<PreparedVerification> {
  assertPasswordCipherReady();
  return Object.freeze({ plain, hash: await hashPassword(plain) });
}
export async function verifyUserCredential(user: CredentialRecord, plain: string) {
  const valid = await verifyPassword(plain, user.password);
  const ambiguousBcrypt = isLegacyBcrypt(user.password) && Buffer.byteLength(plain, "utf8") >= 72;
  return { valid, upgradeAllowed: valid && !ambiguousBcrypt && !isCurrentPasswordHash(user.password) };
}
export function revealUserCredential(user: CredentialRecord): string {
  if (user.passwordCipher) return decryptPassword(user.passwordCipher, user.id, user.credentialVersion);
  if (isHashed(user.password) || /^\$2[aby]\$/.test(user.password)) throw new CredentialError("PASSWORD_LEGACY_HASH_ONLY");
  return user.password;
}

export async function lockUserCredential(tx: Prisma.TransactionClient, userId: number): Promise<CredentialRecord & { username: string }> {
  const rows = await tx.$queryRaw<(CredentialRecord & { username: string })[]>(Prisma.sql`SELECT "id", "username", "password", "passwordCipher", "credentialVersion" FROM "User" WHERE "id" = ${userId} FOR UPDATE`);
  if (!rows[0]) throw new CredentialError("CREDENTIAL_USER_NOT_FOUND");
  return rows[0];
}
export async function writeUserCredential(tx: Prisma.TransactionClient, input: {
  userId: number;
  expectedVersion: number;
  prepared: PreparedVerification;
  token?: string | null;
}): Promise<number> {
  const user = await lockUserCredential(tx, input.userId);
  if (user.credentialVersion !== input.expectedVersion) throw new CredentialError("CREDENTIAL_VERSION_CONFLICT");
  const version = user.credentialVersion + 1;
  const cipher = encryptPassword(input.prepared.plain, user.id, version);
  const updated = await tx.user.updateMany({ where: { id: user.id, credentialVersion: user.credentialVersion, password: user.password }, data: {
    password: input.prepared.hash, passwordCipher: cipher, credentialVersion: version, token: input.token ?? null,
  } });
  if (updated.count !== 1) throw new CredentialError("CREDENTIAL_VERSION_CONFLICT");
  await tx.passwordResetGrant.updateMany({ where: { userId: user.id, revokedAt: null, consumedAt: null }, data: { revokedAt: new Date() } });
  await tx.appSetting.deleteMany({ where: { key: `auth_password_reset_allowed:${user.username}` } });
  return version;
}

export async function createUserCredential(tx: Prisma.TransactionClient, input: { username: string; prepared: PreparedVerification; token?: string }) {
  const user = await tx.user.create({ data: { username: input.username, password: input.prepared.hash } });
  const credentialVersion = await writeUserCredential(tx, { userId: user.id, expectedVersion: 0, prepared: input.prepared, token: input.token });
  return { id: user.id, username: user.username, credentialVersion };
}
