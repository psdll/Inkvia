import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  generation: {
    findFirst: vi.fn(),
    groupBy: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { resolveAdminUserScope } from "@/lib/admin-user-scope";

describe("explicit admin user identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.generation.groupBy.mockResolvedValue([]);
  });

  it("does not guess a numeric guest id as an authenticated account", async () => {
    const scope = await resolveAdminUserScope("123", null, { explicitIdentity: true });

    expect(scope.authUserId).toBeNull();
    expect(scope.generationWhere).toEqual({ authUserId: null, userId: "123" });
    expect(prismaMock.generation.findFirst).not.toHaveBeenCalled();
  });

  it("uses an explicit authenticated identity and only then resolves linked devices", async () => {
    prismaMock.generation.groupBy
      .mockResolvedValueOnce([{ userId: "device-a" }])
      .mockResolvedValueOnce([{ userId: "device-a", authUserId: 7 }]);

    const scope = await resolveAdminUserScope("7", 7, { explicitIdentity: true });

    expect(scope.authUserId).toBe(7);
    expect(scope.linkedUserIds).toEqual(["7", "device-a"]);
    expect(scope.linkedGuestUserIds).toEqual(["device-a"]);
  });

  it("does not guess an account when one device is linked to multiple accounts", async () => {
    prismaMock.generation.groupBy.mockResolvedValueOnce([
      { userId: "device-a", authUserId: 7 },
      { userId: "device-a", authUserId: 8 },
    ]);

    const scope = await resolveAdminUserScope("device-a");

    expect(scope.authUserId).toBeNull();
    expect(scope.generationWhere).toEqual({ authUserId: null, userId: "device-a" });
    expect(prismaMock.generation.findFirst).not.toHaveBeenCalled();
  });

  it("does not attach conflicted guest history to an authenticated account", async () => {
    prismaMock.generation.groupBy
      .mockResolvedValueOnce([{ userId: "device-a" }])
      .mockResolvedValueOnce([
        { userId: "device-a", authUserId: 7 },
        { userId: "device-a", authUserId: 8 },
      ]);

    const scope = await resolveAdminUserScope("7", 7, { explicitIdentity: true });

    expect(scope.linkedUserIds).toEqual(["7", "device-a"]);
    expect(scope.linkedGuestUserIds).toEqual([]);
    expect(scope.generationWhere).toEqual({
      OR: [
        { authUserId: 7 },
        { authUserId: null, userId: { in: [] } },
      ],
    });
  });
});
