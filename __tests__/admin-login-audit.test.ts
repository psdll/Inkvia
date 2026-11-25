import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logAdminAction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/admin-audit", () => ({
  logAdminAction: mocks.logAdminAction,
}));

import { POST } from "@/app/api/admin/login/route";

const previousAdminUsername = process.env.ADMIN_USERNAME;
const previousAdminPassword = process.env.ADMIN_PASSWORD;
const previousAdminSecret = process.env.ADMIN_SECRET;

function loginRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/admin/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-mobile": "?0",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      ...headers,
    },
    body: JSON.stringify({ username: "admin", password: "test-password" }),
  });
}

describe("admin login audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
    process.env.ADMIN_SECRET = "test-secret-with-enough-entropy";
  });

  afterEach(() => {
    if (previousAdminUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = previousAdminUsername;
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    if (previousAdminSecret === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previousAdminSecret;
  });

  it("records the administrator account and a generated browser-device identity after a successful login", async () => {
    const request = loginRequest();

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.logAdminAction).toHaveBeenCalledOnce();
    expect(mocks.logAdminAction).toHaveBeenCalledWith({
      admin: "admin",
      action: "admin_login",
      level: "success",
      message: "管理员账号 admin 登录 · Windows · Chrome · 电脑",
      metadata: {
        browser: "Chrome",
        deviceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        deviceLabel: "Windows · Chrome · 电脑",
        deviceType: "电脑",
        operatingSystem: "Windows",
      },
      req: request,
    });
    expect(response.headers.get("set-cookie")).toContain("ai_studio_admin_device=");
  });

  it("reuses the same valid device identity for later logins from that browser profile", async () => {
    const deviceId = "2aa98088-bdc7-4b7a-8f6a-46ec423e1282";

    const response = await POST(loginRequest({ cookie: `ai_studio_admin_device=${deviceId}` }));

    expect(response.status).toBe(200);
    expect(mocks.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ deviceId }),
    }));
  });

  it("does not block a valid administrator login when audit storage is temporarily unavailable", async () => {
    mocks.logAdminAction.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(loginRequest({ "x-forwarded-for": "203.0.113.11" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("shows administrator login devices in the existing operation log details", () => {
    const source = readFileSync(resolve(process.cwd(), "components/admin/AdminLogsPanel.tsx"), "utf8");

    expect(source).toContain('admin_login: "管理员登录"');
    expect(source).toContain("设备: {row.metadata.deviceLabel}");
    expect(source).toContain("设备ID: {row.metadata.deviceId}");
    expect(source).toContain("User-Agent: {row.userAgent}");
  });
});
