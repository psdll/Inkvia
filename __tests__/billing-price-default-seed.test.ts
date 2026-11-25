import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(async () => []),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: { billingPriceRule: mocks } }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true }),
}));
import { GET, POST, DELETE } from "@/app/api/admin/billing/prices/route";
describe("reference prices and retired unsafe writes", () => {
  beforeEach(() => vi.clearAllMocks());
  it("exposes reference prices without automatically inserting or overwriting prices", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/billing/prices"),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.defaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "volcengine",
          model: "doubao-seedance-2-5-260628",
          unitPrice: 70,
        }),
        expect.objectContaining({
          provider: "reapi",
          model: "gpt-image-2-official-reapi",
        }),
      ]),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("requires the new dated version editor for legacy import/edit/delete requests", async () => {
    for (const action of [POST, DELETE]) {
      const response = await action(
        new Request("http://localhost/api/admin/billing/prices", {
          method: "POST",
          body: JSON.stringify({ action: "seed_defaults" }),
        }) as any,
      );
      expect(response.status).toBe(409);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
