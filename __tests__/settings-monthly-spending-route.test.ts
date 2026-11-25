import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: { id: 7 } as { id: number } | null, report: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/billing/monthly", () => ({ currentBillingMonth: () => "2026-09", monthlyReport: mocks.report }));
import { GET } from "@/app/api/settings/monthly-spending/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 7 };
  mocks.report.mockResolvedValue({ range: { month: "2026-09" }, summary: { totalAmount: "123.45600000", pendingCount: 2 }, daily: [{ day: "2026-09-01", amount: "123.45600000", count: 5 }], models: [{ model: "private-model" }] });
});
it("uses only the authenticated account and returns spending without model details", async () => {
  const response = await GET(new Request("http://localhost/api/settings/monthly-spending?authUserId=99") as any);
  expect(mocks.report).toHaveBeenCalledWith({ month: "2026-09", identity: { authUserId: 7, userIds: ["7"] } });
  expect(await response.json()).toEqual({ month: "2026-09", totalAmount: "123.45600000", pendingCount: 2, daily: [{ day: "2026-09-01", amount: "123.45600000" }] });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("rejects unauthenticated requests before reading billing", async () => {
  mocks.user = null;
  expect((await GET(new Request("http://localhost/api/settings/monthly-spending") as any)).status).toBe(401);
  expect(mocks.report).not.toHaveBeenCalled();
});
