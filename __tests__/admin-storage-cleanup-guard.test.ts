import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  generationFindMany: vi.fn(async () => []),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true, username: "admin" }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    generation: {
      findMany: mocks.generationFindMany,
    },
  },
}));

import { POST } from "@/app/api/admin/storage/route";

function cleanupRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/storage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin storage cleanup guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = "cleanup-secret";
  });

  it("rejects all-user cleanup when the administrator password is wrong", async () => {
    const response = await POST(cleanupRequest({
      action: "cleanup_old_uploads",
      days: 7,
      adminPassword: "wrong-password",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "管理员密码错误，请重新输入",
    });
    expect(mocks.generationFindMany).not.toHaveBeenCalled();
  });

  it("rejects zero days instead of silently converting it to one day", async () => {
    const response = await POST(cleanupRequest({
      action: "cleanup_old_uploads",
      days: 0,
      adminPassword: "cleanup-secret",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "请先设置 1-365 天的保留期限",
    });
    expect(mocks.generationFindMany).not.toHaveBeenCalled();
  });
});
