import { expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { MEDIAKIT_SUBTITLE_MODEL, MEDIAKIT_PROVIDER } from "@/lib/volcengine-mediakit-models";
it.each([[15, .25], [90, 1.5], [1.5, .025]])("prices %s seconds without rounding up a minute", async (duration, amount) => {
  const db = { billingPriceRule: { findMany: async () => [{ id: 1, unitType: "minute", unitPrice: 1, currency: "CNY", priority: 50, matchConditions: null }] }, usageLedger: { upsert: async ({ create }: any) => create } };
  const result = await upsertUsageLedgerForGeneration({ id: 99, userId: "3", authUserId: 3, type: "video_gen", source: "canvas", prompt: "", model: MEDIAKIT_SUBTITLE_MODEL, status: "success", externalProvider: MEDIAKIT_PROVIDER, externalTaskId: "amk-task", errorMsg: null, createdAt: new Date(), finishedAt: new Date(), templateData: JSON.stringify({ model: MEDIAKIT_SUBTITLE_MODEL, duration, providerUsage: { duration } }) }, db);
  expect(result.costStatus).toBe("priced"); expect(result.unitType).toBe("minute"); expect(Number(result.amount)).toBe(amount);
});
