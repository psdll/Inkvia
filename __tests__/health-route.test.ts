import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

import { GET } from "@/app/api/health/route";

describe("health route database contract", () => {
  beforeEach(() => {
    prismaMock.$queryRaw.mockReset();
  });

  it("returns database ok after exactly one read-only SELECT 1", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }]);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ status: "ok", checks: { database: "ok" } });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(String(prismaMock.$queryRaw.mock.calls[0][0])).toBe("SELECT 1 AS ok");
  });

  it("returns a sanitized database error with HTTP 503", async () => {
    prismaMock.$queryRaw.mockRejectedValue(
      new Error("postgresql://secret@localhost/inkvia"),
    );

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toMatchObject({
      status: "error",
      checks: { database: "error" },
    });
    expect(body).not.toContain("postgresql://");
    expect(body).not.toContain("secret");
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
