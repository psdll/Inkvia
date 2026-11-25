import { expect, it } from "vitest";
import type { BillingModel } from "@/lib/billing/catalog";
import type { PriceDraft } from "@/lib/billing/drafts";
import { buildPriceSheets, filterSheetEntries, priceCellVariants, priceSheetEntries } from "@/components/admin/billing-price-sheet";
import { priceConditionLabel } from "@/components/admin/billing-price-display";

const units = { image: "每张", input_million_token: "每百万输入 token", output_million_token: "每百万输出 token" };
const rule = { unitType: "image", unitPrice: "0.000123", currency: "CNY", effectiveFrom: "2026-08-01" };
const slot = { key: "2k", label: "2K", conditions: { resolution: "2K" }, unitType: "image", rule };
const model: BillingModel = { key: "a", provider: "p", providerName: "平台", model: "a", label: "模型 A", module: "image", enabled: true, historical: false, complete: true, slots: [slot], rules: [] };
const draft: PriceDraft = { id: "draft-a", provider: "p", model: "a", module: "image", label: "模型 A", currency: "CNY", notes: "", rows: [{ unitType: "image", price: "0", conditions: { resolution: "2K" } }] };

it("keeps platform columns in the shared order across sheets and appends new platforms by creation order", () => {
  const models = [
    { ...model, provider: "custom-alpha", providerSortOrder: 21 },
    { ...model, provider: "deepseek" },
    { ...model, provider: "kie" },
    { ...model, provider: "custom-zulu", providerSortOrder: 20 },
    { ...model, provider: "apimart" },
  ];
  const entries = priceSheetEntries(models, [{ ...draft, provider: "custom-zulu", model: "draft-only" }]);
  expect(entries.find(entry => entry.model === "draft-only")?.providerSortOrder).toBe(20);
  for (const capacity of [2, 8]) {
    const columns = buildPriceSheets(entries, units, capacity).flatMap(sheet => sheet.columns);
    expect(columns.map(entry => entry.provider)).toEqual([
      "kie", "apimart", "deepseek", "custom-zulu", "custom-zulu", "custom-alpha",
    ]);
    expect(columns.filter(entry => entry.provider === "custom-zulu").map(entry => entry.model)).toEqual(["a", "draft-only"]);
  }
});

it("keeps all models when wrapping columns, and only uses currently selected rules", () => {
  const models = Array.from({ length: 23 }, (_, index) => ({ ...model, key: String(index), model: String(index), label: `模型 ${index}`, rules: [{ ...rule, unitPrice: "999", effectiveFrom: "2030-01-01" }] }));
  const entries = priceSheetEntries(models, []);
  for (const capacity of [4, 8, 12]) {
    const sheets = buildPriceSheets(entries, units, capacity);
    expect(sheets.flatMap((sheet) => sheet.columns)).toHaveLength(23);
    expect(sheets.every((sheet) => sheet.columns.length <= capacity)).toBe(true);
    expect(sheets.flatMap((sheet) => sheet.rows.flatMap((row) => [...row.cells.values()].flat())).map((entry) => entry.price)).toEqual(Array(23).fill("0.000123"));
  }
});

it("deduplicates one current rule covering many slots without hiding specific overrides", () => {
  const broad = { ...rule, matchConditions: { resolution: "2K" } };
  const entries = priceSheetEntries([{ ...model, slots: [
    { ...slot, key: "low", conditions: { resolution: "2K", quality: "low" }, rule: broad },
    { ...slot, key: "medium", conditions: { resolution: "2K", quality: "medium" }, rule: broad },
    { ...slot, key: "high", conditions: { resolution: "2K", quality: "high" }, rule: { ...rule, unitPrice: "0.5", matchConditions: { resolution: "2K", quality: "high" } } },
  ] }], []);
  expect(entries).toHaveLength(2);
  const sheet = buildPriceSheets(entries, units, 8)[0];
  expect(sheet.rows).toHaveLength(1);
  const variants = priceCellVariants([...sheet.rows[0].cells.values()].flat());
  expect(variants.map((variant) => variant.label)).toEqual(["", "画质 high"]);
  expect(variants.map((variant) => variant.prices[0].price)).toEqual(["0.000123", "0.5"]);
});

it("aligns unordered boolean/range conditions and preserves multiple drafts, blanks, and zero", () => {
  const entries = priceSheetEntries([{ ...model, slots: [{ ...slot, conditions: { generateAudio: true, resolution: "2K" } }] }], [
    { ...draft, rows: [{ ...draft.rows[0], conditions: { resolution: ["2K", "4K"], generateAudio: "true" } }] },
    { ...draft, id: "blank-version", rows: [{ ...draft.rows[0], price: "", conditions: { resolution: "2k", generateAudio: true } }] },
  ]);
  const sheets = buildPriceSheets(entries, units, 8);
  expect(sheets).toHaveLength(1);
  expect(sheets[0].rows).toHaveLength(2);
  const variants = priceCellVariants([...sheets[0].rows[0].cells.values()].flat());
  expect(variants).toHaveLength(1);
  expect(variants[0].prices.map((price) => price.price)).toEqual(["0.000123", "0", ""]);
  expect(variants[0].prices.map((price) => price.draft?.id)).toEqual([undefined, "draft-a", "blank-version"]);
});

it("separates currencies and billing units while keeping token input/output on different rows", () => {
  const drafts = [draft, { ...draft, id: "usd", currency: "USD" }, { ...draft, id: "tokens", rows: [
    { conditions: {}, unitType: "input_million_token", price: "0" },
    { conditions: {}, unitType: "output_million_token", price: "2" },
  ] }];
  const sheets = buildPriceSheets(priceSheetEntries([model], drafts), units, 8);
  expect(sheets.map((sheet) => [sheet.currency, sheet.unit])).toEqual([["CNY", "image"], ["USD", "image"], ["CNY", "million_token"]]);
  expect(sheets[2].rows.map((row) => row.label)).toEqual(["输入", "输出"]);
});

it("retains orphan drafts and keeps current/draft context when filtering models", () => {
  const entries = priceSheetEntries([model], [draft, { ...draft, id: "orphan", model: "retired", label: "旧模型" }]);
  expect(entries.find((entry) => entry.model === "retired")?.catalogModel).toBeUndefined();
  const result = filterSheetEntries(entries, " 模型 a ", "p", "draft");
  expect(result).toHaveLength(2);
  expect(result.map((entry) => entry.price)).toEqual(["0.000123", "0"]);
  expect(filterSheetEntries(entries, "不存在", "", "all")).toHaveLength(0);
});

it("merges identical missing variants without inventing a missing parameter combination", () => {
  const conditions = [
    { quality: "low", aspectRatio: "1:1" },
    { quality: "high", aspectRatio: "1:1" },
    { quality: "low", aspectRatio: "16:9" },
  ];
  const entries = priceSheetEntries([{ ...model, slots: conditions.map((condition, index) => ({ ...slot, key: String(index), conditions: condition, rule: undefined, missing: "缺价格" })) }], []);
  const variants = priceCellVariants(entries);
  expect(variants).toHaveLength(2);
  const combinations = variants.flatMap((variant) => {
    const c = variant.prices[0].conditions;
    return [c.quality].flat().flatMap((quality) => [c.aspectRatio].flat().map((ratio) => `${quality}|${ratio}`));
  });
  expect(combinations.sort()).toEqual(["high|1:1", "low|16:9", "low|1:1"].sort());
  expect(priceConditionLabel({ inputContainsVideo: true })).toContain("有参考视频");
});
