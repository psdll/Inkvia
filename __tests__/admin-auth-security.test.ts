import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { adminEnabled, createAdminToken, verifyAdminToken, isAdminRequest, requireAdminRequest } from "@/lib/admin-auth";

function signed(payload: unknown, secret = "synthetic-secret") {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
function request(token: string) { return new NextRequest("http://localhost/api/admin/auth-users", { headers: { cookie: `ai_studio_admin=${token}` } }); }
beforeEach(() => { vi.stubEnv("ADMIN_USERNAME", "admin"); vi.stubEnv("ADMIN_PASSWORD", "synthetic-password"); vi.stubEnv("ADMIN_SECRET", "synthetic-secret"); });
afterEach(() => vi.unstubAllEnvs());
describe("administrator authentication configuration boundary", () => {
  it.each(["", " ", "\t\n"])("refuses missing/blank secrets and password configuration (%j)", value => {
    const legitimate = createAdminToken("admin");
    for (const key of ["ADMIN_PASSWORD", "ADMIN_SECRET"]) {
      vi.stubEnv(key, value);
      expect(adminEnabled()).toBe(false);
      expect(() => createAdminToken("admin")).toThrow("ADMIN_NOT_CONFIGURED");
      expect(verifyAdminToken(legitimate)).toBeNull();
      expect(isAdminRequest(request(legitimate))).toBe(false);
      expect(requireAdminRequest(request(legitimate))).toMatchObject({ ok: false });
      vi.stubEnv(key, key === "ADMIN_PASSWORD" ? "synthetic-password" : "synthetic-secret");
    }
  });
  it("accepts a legitimate administrator consistently", () => {
    const token = createAdminToken("admin");
    expect(isAdminRequest(request(token))).toBe(true);
    expect(requireAdminRequest(request(token))).toEqual({ ok: true, username: "admin" });
    expect(verifyAdminToken(`${token}.extra`)).toBeNull();
    expect(verifyAdminToken(token.slice(0, -1))).toBeNull();
  });
  it("rejects signed malformed, expired, future-issued and wrong-user payloads", () => {
    const now = Math.floor(Date.now() / 1000);
    for (const payload of [null, [], {}, { u: "admin", iat: now, exp: String(now + 30) }, { u: {}, iat: now, exp: now + 30 }, { u: "other", iat: now, exp: now + 30 }, { u: "admin", iat: now, exp: now }, { u: "admin", iat: now + 10, exp: now + 30 }]) expect(verifyAdminToken(signed(payload))).toBeNull();
    expect(verifyAdminToken(signed({ u: "admin", iat: now, exp: now + 30 }, ""))).toBeNull();
  });
});
