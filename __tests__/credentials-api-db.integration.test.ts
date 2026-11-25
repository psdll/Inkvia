import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as resetAvailable, POST as reset } from "@/app/api/auth/password-reset/route";
import { GET as accounts, POST as manage } from "@/app/api/admin/auth-users/route";
import { createAdminToken } from "@/lib/admin-auth";
import { accountExportRecord } from "@/lib/admin/account-export";
import { resolveImportedUser } from "@/lib/admin/user-import-restore";

const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;
const usernames: string[] = [];
function request(endpoint: string, body: unknown, admin = false) {
  return new NextRequest(`http://localhost${endpoint}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": `p0-${randomUUID()}`,
    ...(admin ? { cookie: `ai_studio_admin=${createAdminToken(process.env.ADMIN_USERNAME || "admin")}` } : {}) }, body: JSON.stringify(body) });
}
afterAll(async () => {
  if (usernames.length) {
    await prisma.user.deleteMany({ where: { username: { in: usernames } } });
    await prisma.whitelistName.deleteMany({ where: { name: { in: usernames } } });
    await prisma.appSetting.deleteMany({ where: { key: { in: usernames.map(name => `auth_password_reset_allowed:${name}`) } } });
  }
  await prisma.$disconnect();
});

describe("credential API behavior with synthetic database records", () => {
  integration("allows one token-free reset after administrator permission and invalidates old sessions", async () => {
    const username = `p0-api-${randomUUID()}`; usernames.push(username);
    const password = " 合成密码-only ";
    await prisma.whitelistName.create({ data: { name: username } });
    const registration = await register(request("/api/auth/register", { username, password }));
    expect(registration.status).toBe(200);
    const registered = await registration.json();
    expect(Object.keys(registered.user).sort()).toEqual(["id", "username"]);
    const signedIn = await login(request("/api/auth/login", { username, password })); expect(signedIn.status).toBe(200);
    const before = await prisma.user.findUniqueOrThrow({ where: { username } });
    const reveal = await manage(request("/api/admin/auth-users", { action: "reveal_password", userId: before.id, adminPassword: process.env.ADMIN_PASSWORD }, true));
    expect(reveal.status).toBe(200); expect(reveal.headers.get("cache-control")).toBe("no-store");
    expect(await reveal.json()).toMatchObject({ password, credentialVersion: 1 });
    expect((await reset(request("/api/auth/password-reset", { username, newPassword: "not-allowed" }))).status).toBe(403);
    const permissionResponse = await manage(request("/api/admin/auth-users", { action: "set_self_reset", userId: before.id, allowed: true }, true));
    expect(permissionResponse.status).toBe(200);
    expect(await permissionResponse.json()).toEqual({ success: true, passwordResetAllowed: true });
    const availability = await resetAvailable(new NextRequest(`http://localhost/api/auth/password-reset?username=${username}`));
    expect(await availability.json()).toEqual({ allowed: true });
    const resetResponse = await reset(request("/api/auth/password-reset", { username, newPassword: " 新密码 " }));
    expect(resetResponse.status).toBe(200); expect(resetResponse.cookies.get("auth_token")?.value).toBeTruthy();
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(updated.credentialVersion).toBe(2); expect(updated.token).not.toBe(before.token);
    expect((await login(request("/api/auth/login", { username, password }))).status).toBe(401);
    expect((await login(request("/api/auth/login", { username, password: " 新密码 " }))).status).toBe(200);
    expect((await reset(request("/api/auth/password-reset", { username, newPassword: "replay-password" }))).status).toBe(403);
    expect(await (await resetAvailable(new NextRequest(`http://localhost/api/auth/password-reset?username=${username}`))).json()).toEqual({ allowed: false });
    const list = await accounts(new NextRequest("http://localhost/api/admin/auth-users", { headers: { cookie: `ai_studio_admin=${createAdminToken(process.env.ADMIN_USERNAME || "admin")}` } }));
    const text = await list.text(); expect(text).not.toContain(updated.password); expect(text).not.toContain("passwordCipher"); expect(text).not.toContain("resetToken");
    const exported = accountExportRecord(updated); expect(Object.keys(exported!).sort()).toEqual(["createdAt", "id", "updatedAt", "username"]);
    await resolveImportedUser(prisma.user, { ...updated, password: "injected", passwordCipher: { injected: true }, token: "injected", credentialVersion: 500 }, async () => {});
    expect((await prisma.user.findUniqueOrThrow({ where: { id: before.id } })).password).toBe(updated.password);
  }, 25000);
  integration("retains administrator password reconfirmation and rejects foreign request origins", async () => {
    const username = `p0-api-${randomUUID()}`; usernames.push(username);
    const user = await prisma.user.create({ data: { username, password: "synthetic-legacy" } });
    const incorrect = await manage(request("/api/admin/auth-users", { action: "reveal_password", userId: user.id, adminPassword: "wrong" }, true));
    expect(incorrect.status).toBe(401);
    const foreign = request("/api/admin/auth-users", { action: "reveal_password", userId: user.id, adminPassword: process.env.ADMIN_PASSWORD }, true);
    foreign.headers.set("origin", "https://foreign.invalid");
    expect((await manage(foreign)).status).toBe(403);
  });
});
