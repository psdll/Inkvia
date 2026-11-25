import { expect, it } from "vitest";
import { batchDrafts } from "@/lib/billing/batch-drafts";
import type { PriceDraft } from "@/lib/billing/drafts";

it("skips unavailable drafts without deleting history or blocking current models", () => {
  const draft = (model: string): PriceDraft => ({ id: model, provider: "p", model, module: "video", label: model,
    currency: "CNY", notes: "", rows: [{ conditions: {}, unitType: "second", price: "1" }] });
  const drafts = [draft("deleted"), draft("active"), draft("changed")];
  const before = structuredClone(drafts);
  const plan = batchDrafts(drafts, "", [{ provider: "p", model: "active", module: "video" },
    { provider: "p", model: "changed", module: "image" }]);
  expect(plan.ready.map(d => d.model)).toEqual(["active"]);
  expect(plan.rowCount).toBe(1);
  expect(plan.unavailable).toEqual(["deleted", "changed"]);
  expect(drafts).toEqual(before);
});

it("continues to require a choice between multiple drafts and respects supplier scope", () => {
  const d: PriceDraft = { id: "1", provider: "p", model: "m", module: "image", label: "M",
    currency: "CNY", notes: "", rows: [{ conditions: {}, unitType: "image", price: "0" }] };
  const plan = batchDrafts([d, { ...d, id: "2" }, { ...d, provider: "other", id: "3" }], "p", [d]);
  expect(plan.ready).toEqual([]);
  expect(plan.conflicts).toEqual(["M"]);
  expect(plan.unavailable).toEqual([]);
});
