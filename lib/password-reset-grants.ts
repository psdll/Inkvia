import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CredentialError } from "@/lib/password-crypto";
import { lockUserCredential, preparePasswordVerification, writeUserCredential } from "@/lib/user-credentials";

export function resetTokenDigest(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new CredentialError("PASSWORD_RESET_INVALID");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function issuePasswordResetGrant(userId: number, createdBy: string, db: PrismaClient = prisma) {
  const resetToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const record = await db.$transaction(async tx => {
    const user = await lockUserCredential(tx, userId);
    await tx.passwordResetGrant.updateMany({ where: { userId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    return tx.passwordResetGrant.create({ data: { userId, tokenDigest: resetTokenDigest(resetToken), credentialVersion: user.credentialVersion, expiresAt, createdBy } });
  });
  return { grantId: record.id, resetToken, expiresAt: expiresAt.toISOString() };
}

export async function revokePasswordResetGrants(userId: number, db: PrismaClient = prisma) {
  await db.$transaction(async tx => {
    await lockUserCredential(tx, userId);
    await tx.passwordResetGrant.updateMany({ where: { userId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}

export async function consumePasswordResetGrant(input: { username: string; resetToken: string; newPassword: string; sessionToken: string }, db: PrismaClient = prisma) {
  const tokenDigest = resetTokenDigest(input.resetToken);
  const initial = await db.passwordResetGrant.findUnique({ where: { tokenDigest }, include: { user: { select: { username: true, credentialVersion: true } } } });
  if (!initial || initial.user.username !== input.username || initial.consumedAt || initial.revokedAt || initial.expiresAt <= new Date() || initial.credentialVersion !== initial.user.credentialVersion) throw new CredentialError("PASSWORD_RESET_INVALID");
  // Expensive preparation occurs outside the row lock; validity is checked again below.
  const prepared = await preparePasswordVerification(input.newPassword);
  return db.$transaction(async tx => {
    const user = await lockUserCredential(tx, initial.userId);
    if (user.credentialVersion !== initial.credentialVersion) throw new CredentialError("PASSWORD_RESET_INVALID");
    const consumed = await tx.passwordResetGrant.updateMany({ where: { id: initial.id, userId: user.id, tokenDigest, credentialVersion: user.credentialVersion, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new CredentialError("PASSWORD_RESET_INVALID");
    const credentialVersion = await writeUserCredential(tx, { userId: user.id, expectedVersion: user.credentialVersion, prepared, token: input.sessionToken });
    return { id: user.id, username: input.username, credentialVersion, grantId: initial.id };
  });
}
