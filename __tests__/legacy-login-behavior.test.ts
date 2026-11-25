import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/login/route";

const db = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: db } }));
vi.mock("@/lib/server-auth", () => ({ generateToken: () => "synthetic-session" }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "synthetic-ip", rateLimit: () => ({ ok: true }) }));

function request(password: string) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "合成旧账号", password }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  db.findUnique.mockResolvedValue({ id: 77, username: "合成旧账号", password: "旧密码-42", passwordCipher: null, credentialVersion: 0 });
  db.updateMany.mockResolvedValue({ count: 1 });
});

describe("legacy account login after credential schema upgrade", () => {
  it("accepts the unchanged legacy password and issues a session without rewriting credentials", async () => {
    const result = await POST(request("旧密码-42"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ success: true, user: { id: 77 } });
    expect(result.cookies.get("auth_token")?.value).toBe("synthetic-session");
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: 77, credentialVersion: 0, password: "旧密码-42" },
      data: { token: "synthetic-session" },
    });
  });
  it("rejects an incorrect password without changing the account", async () => {
    expect((await POST(request("incorrect synthetic password"))).status).toBe(401);
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it("does not issue a session if credentials change during login", async () => {
    db.updateMany.mockResolvedValue({ count: 0 });
    const result = await POST(request("旧密码-42"));
    expect(result.status).toBe(409);
    expect(result.cookies.get("auth_token")).toBeUndefined();
  });
});
