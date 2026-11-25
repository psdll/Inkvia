import prisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { CredentialError } from "@/lib/password-crypto";
import { lockUserCredential, preparePasswordVerification, writeUserCredential } from "@/lib/user-credentials";

const KEY_PREFIX = "auth_password_reset_allowed:";

function normalizeUsername(username: unknown) {
  return String(username || "").trim();
}

function keyForUsername(username: string) {
  return `${KEY_PREFIX}${username}`;
}

export async function getPasswordResetAllowedUsernames(usernames: string[], db: PrismaClient = prisma) {
  const normalized = Array.from(new Set(usernames.map(normalizeUsername).filter(Boolean)));
  if (!normalized.length) return new Set<string>();

  const rows = await db.appSetting.findMany({
    where: { key: { in: normalized.map(keyForUsername) }, value: "1" },
    select: { key: true },
  });

  const allowed = new Set<string>();
  for (const row of rows) {
    allowed.add(row.key.slice(KEY_PREFIX.length));
  }
  return allowed;
}

export async function isPasswordResetAllowed(username: unknown, db: PrismaClient = prisma) {
  const normalized = normalizeUsername(username);
  if (!normalized) return false;
  const allowed = await getPasswordResetAllowedUsernames([normalized], db);
  return allowed.has(normalized);
}

export async function setPasswordResetAllowed(username: unknown, allowed: boolean, db: PrismaClient = prisma) {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error("username is required");
  const key = keyForUsername(normalized);
  await db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { username: normalized }, select: { id: true } });
    if (user) await lockUserCredential(tx, user.id);
    else if (allowed) throw new CredentialError("CREDENTIAL_USER_NOT_FOUND");
    await tx.passwordResetGrant.updateMany({ where: { user: { username: normalized }, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (allowed) {
      await tx.appSetting.upsert({ where: { key }, create: { key, value: "1" }, update: { value: "1" } });
    } else {
      await tx.appSetting.deleteMany({ where: { key } });
    }
  });
}

export async function resetPasswordWithPermission(input: { username: string; newPassword: string; sessionToken: string }, db: PrismaClient = prisma) {
  const initial = await db.user.findUnique({ where: { username: input.username }, select: { id: true, credentialVersion: true } });
  if (!initial || !await isPasswordResetAllowed(input.username, db)) throw new CredentialError("PASSWORD_RESET_INVALID");
  const prepared = await preparePasswordVerification(input.newPassword);
  return db.$transaction(async tx => {
    const user = await lockUserCredential(tx, initial.id);
    if (user.credentialVersion !== initial.credentialVersion) throw new CredentialError("PASSWORD_RESET_INVALID");
    // Consume the administrator's permission in the same transaction as the password change.
    const consumed = await tx.appSetting.deleteMany({ where: { key: keyForUsername(input.username), value: "1" } });
    if (consumed.count !== 1) throw new CredentialError("PASSWORD_RESET_INVALID");
    const credentialVersion = await writeUserCredential(tx, { userId: user.id, expectedVersion: user.credentialVersion, prepared, token: input.sessionToken });
    return { id: user.id, username: input.username, credentialVersion };
  });
}
