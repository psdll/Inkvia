import { expect, it, vi } from "vitest";
import { previewAll, applyAll, type ReconcileBatch } from "@/lib/billing/reconcile-all";
const batch = (nextCursor: number, hasMore: boolean, count: number): ReconcileBatch => ({
  digest: `digest-${nextCursor}`, scanned: 100, nextCursor, hasMore, amountCny: "1", updated: count,
  items: Array.from({ length: count }, (_, i) => ({ id: i, model: "m", before: "0", after: "1" })),
});
it("scans past empty batches then applies every eligible batch with one plan", async () => {
  const request = vi.fn().mockResolvedValueOnce(batch(100, true, 0))
    .mockResolvedValueOnce(batch(200, true, 2)).mockResolvedValueOnce(batch(250, false, 1));
  const plan = await previewAll(request, vi.fn());
  expect(request.mock.calls.map(c => c[1])).toEqual([0, 100, 200]);
  const apply = vi.fn().mockResolvedValueOnce(batch(200, true, 2)).mockResolvedValueOnce(batch(250, false, 1));
  const progress = vi.fn();
  expect(await applyAll(apply, plan, progress)).toBe(3);
  expect(apply.mock.calls).toEqual([["apply", 100, "digest-200"], ["apply", 200, "digest-250"]]);
  expect(progress.mock.calls).toEqual([[2], [3]]);
});
it("stops on a changed or failed batch and does not silently continue writing", async () => {
  const plan = { scanned: 300, batches: [0, 100, 200].map(cursor => ({ cursor, preview: batch(cursor + 100, true, 1) })) };
  const apply = vi.fn().mockResolvedValueOnce(batch(100, true, 1)).mockRejectedValueOnce(new Error("价格变化"));
  const progress = vi.fn();
  await expect(applyAll(apply, plan, progress)).rejects.toThrow("价格变化");
  expect(apply).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenCalledWith(1);
});
it("rejects a stuck pagination cursor", async () => {
  await expect(previewAll(vi.fn().mockResolvedValue(batch(0, true, 0)), vi.fn())).rejects.toThrow("分页未前进");
});
