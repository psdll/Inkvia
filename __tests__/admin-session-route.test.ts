import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/session/route";
import { adminCookieName, createAdminToken } from "@/lib/admin-auth";

const previousAdminPassword = process.env.ADMIN_PASSWORD;
const previousAdminSecret = process.env.ADMIN_SECRET;

describe("admin request-scoped session gate", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
    process.env.ADMIN_SECRET = "test-secret-with-enough-entropy";
  });

  afterEach(() => {
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    if (previousAdminSecret === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previousAdminSecret;
  });

  it("accepts a valid admin cookie from the current request without caching", async () => {
    const token = createAdminToken(process.env.ADMIN_USERNAME?.trim() || "admin");
    const request = new NextRequest("http://127.0.0.1/api/admin/session", {
      headers: { cookie: `${adminCookieName()}=${token}` },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects a missing admin cookie", async () => {
    const response = await GET(new NextRequest("http://127.0.0.1/api/admin/session"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
  });

  it("keeps the admin page gate request-scoped", () => {
    const root = process.cwd();
    const layout = readFileSync(resolve(root, "app/admin/layout.tsx"), "utf8");
    const gate = readFileSync(resolve(root, "components/admin/AdminSessionGate.tsx"), "utf8");

    expect(layout).toContain("initialAuthenticated={Boolean(verifyAdminToken(cookies().get(adminCookieName())?.value))}");
    expect(layout).not.toContain("isAdminServer");
    expect(gate).toContain('fetchJsonOnce<{ authenticated?: boolean }>("/api/admin/session")');
    expect(gate).toContain('window.location.replace("/settings?admin=1")');
  });
});
