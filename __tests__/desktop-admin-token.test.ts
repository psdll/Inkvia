import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { createAdminToken, verifyAdminToken } from "@/lib/admin-auth";

const { createDesktopAdminToken } = createRequire(import.meta.url)("../desktop/lib/session.cjs");

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("writes the same token bytes as the web signer for the same payload and secret", () => {
  const now = 1_790_000_000;
  const ttl = 10 * 365 * 24 * 60 * 60;
  const secret = "  isolated-test-secret  ";
  vi.stubEnv("ADMIN_USERNAME", "admin");
  vi.stubEnv("ADMIN_PASSWORD", "test-only");
  vi.stubEnv("ADMIN_SECRET", secret);
  vi.spyOn(Date, "now").mockReturnValue(now * 1000 + 999);

  const fromWeb = createAdminToken("admin", ttl);
  const fromDesktop = createDesktopAdminToken("admin", secret);
  expect(fromDesktop).toBe(fromWeb);
  const payload = { u: "admin", iat: now, exp: now + ttl };
  expect(verifyAdminToken(fromWeb)).toEqual(payload);
  expect(verifyAdminToken(fromDesktop)).toEqual(payload);
  expect(verifyAdminToken(createDesktopAdminToken("admin", "wrong-secret"))).toBeNull();
});
