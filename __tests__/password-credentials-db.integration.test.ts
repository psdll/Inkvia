import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { guardPrismaClient, getRuntimePolicy } from "../scripts/lib/runtime-isolation.cjs";
import { createUserCredential, preparePasswordVerification, revealUserCredential, writeUserCredential } from "@/lib/user-credentials";
import { issuePasswordResetGrant, consumePasswordResetGrant, revokePasswordResetGrants } from "@/lib/password-reset-grants";
import { verifyPassword } from "@/lib/password";
import { isPasswordResetAllowed, resetPasswordWithPermission, setPasswordResetAllowed } from "@/lib/password-reset-permission";

const enabled = process.env.RUN_P0_DB_TESTS === "1";
const integration = enabled ? it : it.skip;
const ids: number[] = [];
const db = enabled ? guardPrismaClient(new PrismaClient(), getRuntimePolicy()) : null;
async function user() {
  const result = await db!.$transaction(async tx => createUserCredential(tx, { username: `p0-credential-${randomUUID()}`, prepared: await preparePasswordVerification("synthetic-original"), token: "session-" + randomUUID() }));
  ids.push(result.id); return result;
}
afterAll(async () => { if (db) { await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); } });
describe("credential transactions on the separately provisioned PostgreSQL instance", () => {
  integration("consumes administrator permission once under concurrent token-free reset requests", async () => {
    const account = await user();
    await setPasswordResetAllowed(account.username, true, db!);
    const input = { username: account.username, newPassword: "self-service-new", sessionToken: randomUUID() };
    const results = await Promise.allSettled([
      resetPasswordWithPermission(input, db!),
      resetPasswordWithPermission({ ...input, newPassword: "other-new", sessionToken: randomUUID() }, db!),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await isPasswordResetAllowed(account.username, db!)).toBe(false);
    const row = await db!.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.credentialVersion).toBe(2);
    expect(await verifyPassword(revealUserCredential(row), row.password)).toBe(true);
    await expect(resetPasswordWithPermission(input, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
  }, 20000);
  integration("rejects missing, revoked and other-account permission and allows an administrator to enable it again", async () => {
    const account = await user();
    const input = { username: account.username, newPassword: "self-service-new", sessionToken: randomUUID() };
    await expect(resetPasswordWithPermission(input, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
    await setPasswordResetAllowed(account.username, true, db!);
    await expect(resetPasswordWithPermission({ ...input, username: "missing-account" }, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
    await setPasswordResetAllowed(account.username, false, db!);
    await expect(resetPasswordWithPermission(input, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
    await setPasswordResetAllowed(account.username, true, db!);
    await resetPasswordWithPermission(input, db!);
    expect(await isPasswordResetAllowed(account.username, db!)).toBe(false);
  }, 20000);
  integration("revokes self-reset permission when the administrator changes the password", async () => {
    const account = await user();
    await setPasswordResetAllowed(account.username, true, db!);
    const prepared = await preparePasswordVerification("administrator-new");
    await db!.$transaction(tx => writeUserCredential(tx, { userId: account.id, expectedVersion: account.credentialVersion, prepared }));
    expect(await isPasswordResetAllowed(account.username, db!)).toBe(false);
    await expect(resetPasswordWithPermission({ username: account.username, newPassword: "self-new", sessionToken: randomUUID() }, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
  }, 20000);
  integration("creates matching verification/ciphertext and atomically invalidates prior sessions", async () => {
    const account = await user();
    let row = await db!.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.password).toMatch(/^\$scrypt\$/); expect(revealUserCredential(row)).toBe("synthetic-original");
    const prepared = await preparePasswordVerification(" 新的合成密码 ");
    await db!.$transaction(tx => writeUserCredential(tx, { userId: row.id, expectedVersion: row.credentialVersion, prepared }));
    row = await db!.user.findUniqueOrThrow({ where: { id: row.id } });
    expect(row.token).toBeNull(); expect(row.credentialVersion).toBe(2);
    expect(revealUserCredential(row)).toBe(" 新的合成密码 "); expect(await verifyPassword(" 新的合成密码 ", row.password)).toBe(true);
  }, 15000);
  integration("consumes a single grant only once under concurrent requests, with no half-written password", async () => {
    const account = await user(); const grant = await issuePasswordResetGrant(account.id, "synthetic-admin", db!);
    const input = { username: account.username, resetToken: grant.resetToken, newPassword: "concurrent-new", sessionToken: randomUUID() };
    const results = await Promise.allSettled([consumePasswordResetGrant(input, db!), consumePasswordResetGrant({ ...input, newPassword: "other-new", sessionToken: randomUUID() }, db!)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const row = await db!.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.credentialVersion).toBe(2); expect(await verifyPassword(revealUserCredential(row), row.password)).toBe(true);
    expect((await db!.passwordResetGrant.findUniqueOrThrow({ where: { id: grant.grantId } })).consumedAt).not.toBeNull();
    await expect(consumePasswordResetGrant(input, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
  }, 20000);
  integration("denies wrong-account, revoked and expired grants", async () => {
    const account = await user();
    const input = { username: account.username, newPassword: "reset-synthetic", sessionToken: randomUUID() };
    let grant = await issuePasswordResetGrant(account.id, "synthetic-admin", db!);
    await expect(consumePasswordResetGrant({ ...input, username: "wrong-account", resetToken: grant.resetToken }, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
    await revokePasswordResetGrants(account.id, db!);
    await expect(consumePasswordResetGrant({ ...input, resetToken: grant.resetToken }, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
    grant = await issuePasswordResetGrant(account.id, "synthetic-admin", db!);
    await db!.passwordResetGrant.update({ where: { id: grant.grantId }, data: { expiresAt: new Date(0) } });
    await expect(consumePasswordResetGrant({ ...input, resetToken: grant.resetToken }, db!)).rejects.toThrow("PASSWORD_RESET_INVALID");
  }, 15000);
  integration("serializes administrator reset against self reset and stale backfill", async () => {
    const account = await user(); const grant = await issuePasswordResetGrant(account.id, "synthetic-admin", db!);
    const prepared = await preparePasswordVerification("administrator-new");
    const results = await Promise.allSettled([
      db!.$transaction(tx => writeUserCredential(tx, { userId: account.id, expectedVersion: account.credentialVersion, prepared })),
      consumePasswordResetGrant({ username: account.username, resetToken: grant.resetToken, newPassword: "self-new", sessionToken: randomUUID() }, db!),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await expect(db!.$transaction(tx => writeUserCredential(tx, { userId: account.id, expectedVersion: account.credentialVersion, prepared }))).rejects.toThrow("CREDENTIAL_VERSION_CONFLICT");
    const row = await db!.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.credentialVersion).toBe(2); expect(await verifyPassword(revealUserCredential(row), row.password)).toBe(true);
  }, 20000);
});
