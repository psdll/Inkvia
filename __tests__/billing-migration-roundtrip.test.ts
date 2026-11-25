import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { BillingModel } from "@/lib/billing/catalog";

// Optional real-data run: verify-price-migration.ts writes the fixture.
// All import/publication writes below stay in memory, never Prisma.
const state = vi.hoisted(() => ({ rules: [] as any[], settings: {} as any, providers: [] as any[] }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: () => ({ ok: true }) }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: async () => state.providers }));
vi.mock("@/lib/providers/model-availability", () => ({ isProviderModelEnabled: () => true }));
vi.mock("@/lib/billing/settings", () => ({
  readBillingSettings: async () => structuredClone(state.settings),
  withBillingWrite: async (fn: any) => {
    const before = structuredClone(state);
    try { return await fn(db); } catch (e) { Object.assign(state, before); throw e; }
  },
}));
const db = {
  billingPriceRule: {
    findMany: async ({ where }: any = {}) => state.rules.filter(r =>
      (!where?.provider || where.provider === r.provider) &&
      (!where?.model || (typeof where.model === "string" ? where.model === r.model : where.model.in.includes(r.model))) &&
      (where?.isActive === undefined || where.isActive === r.isActive)),
    updateMany: async ({ where, data }: any) => {
      for (const r of state.rules) if (r.provider === where.provider && r.model === where.model && r.isActive &&
        (!where.id || where.id.in.includes(r.id)) && +r.effectiveFrom < +where.effectiveFrom.lt &&
        (!r.effectiveTo || +r.effectiveTo > +data.effectiveTo)) Object.assign(r, data);
    },
    createMany: async ({ data }: any) => { for (const row of data) state.rules.push({ ...row, id: state.rules.length + 1 }); },
  },
  usageLedger: { groupBy: async () => [] },
  appSetting: { upsert: async ({ update }: any) => { state.settings = JSON.parse(update.value); } },
};
import { GET, POST } from "@/app/api/admin/billing/catalog/route";
import { getBillingCatalog } from "@/lib/billing/catalog";
import { exportCurrentPrices } from "@/lib/billing/migration";
import { validateDraft } from "@/lib/billing/drafts";
const getFile = async () => {
  const response = await GET({ nextUrl: new URL("http://localhost/api/admin/billing/catalog?export=migration") } as any);
  const file = await response.json();
  expect(response.status, JSON.stringify(file)).toBe(200);
  return file;
};
async function post(body: any) {
  const response = await POST(new Request("http://localhost/api/admin/billing/catalog", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, revision: state.settings.revision }),
  }) as any);
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(200);
  return result;
}
const row = { provider: "kie", model: "nano-banana-pro", module: "image", displayName: "Nano", currency: "USD",
  unitType: "image", unitPrice: "0.000123", matchConditions: {}, priority: 100, isActive: true,
  effectiveFrom: new Date("2026-09-01"), effectiveTo: null, notes: "platform original price" };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T04:00:00Z"));
  state.rules = [];
  state.settings = { revision: 0, mode: "observe", rates: [] };
  state.providers = [{ id: "kie", name: "KIE", chatModels: [], imageModels: ["nano-banana-pro"], videoModels: [], audioModels: [] }];
});
afterEach(() => vi.useRealTimers());

it("exports current prices without old/future/retired versions or drafts, and round-trips zero, precision and required FX", async () => {
  state.rules = [
    { ...row, id: 1 },
    { ...row, id: 2, unitPrice: "0", matchConditions: { resolution: "4K" } },
    { ...row, id: 3, unitPrice: "99", effectiveFrom: new Date("2027-01-01") },
    { ...row, id: 4, unitPrice: "88", effectiveFrom: new Date("2020-01-01"), effectiveTo: new Date("2021-01-01") },
    { ...row, id: 5, model: "removed-model", unitPrice: "77" },
  ];
  state.settings.drafts = [validateDraft({ ...row, rows: [{ unitType: "image", conditions: {}, price: "66" }] })];
  state.settings.rates = ["2020-01-01", "2026-01-01", "2027-01-01"].map((date, i) => ({ id: `${i}`, provider: "kie", currency: "USD", rate: ["6", "7.123456", "8"][i], effectiveFrom: new Date(date).toISOString() }));
  const file = await getFile();
  expect(file.prices).toEqual([]);
  expect(file.drafts).toHaveLength(1);
  expect(file.drafts[0].rows).toHaveLength(3);
  expect(file.drafts[0].rows.map((r: any) => r.price)).toEqual(["0.000123", "0.000123", "0"]);
  expect(file.rates).toHaveLength(1);
  expect(file.rates[0].rate).toBe("7.123456");
  state.rules = []; state.settings = { mode: "observe", revision: 0, rates: [] };
  await roundtrip(file);
});

async function roundtrip(file: any) {
  const preview = await post({ action: "previewImport", file });
  expect(preview.importReport.items.every((i: any) => i.status === "ready")).toBe(true);
  expect(state.settings.drafts).toBeUndefined();
  await post({ action: "importDrafts", file });
  const duplicate = await post({ action: "importDrafts", file });
  expect(duplicate.importReport.items.every((i: any) => i.status === "existing")).toBe(true);
  const published = await post({ action: "publishDrafts", effectiveDate: "2026-10-02" });
  expect(published.published.conflicts).toEqual([]);
  expect(published.published.models).toBe(file.drafts.length);
  expect(state.settings.drafts).toEqual([]);
  const restored = await getFile();
  const comparable = (snapshot: any) => snapshot.drafts.map((d: any) => ({ provider: d.provider, model: d.model,
    currency: d.currency, rows: d.rows })).sort((a: any, b: any) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`));
  expect(comparable(restored)).toEqual(comparable(file));
  expect(restored.rates.map((r: any) => [r.provider, r.currency, r.rate])).toEqual(file.rates.map((r: any) => [r.provider, r.currency, r.rate]));
}

it("imports and publishes subtitle erasure V5 minute prices", async () => {
  state.providers = [{ id: "volcengine-mediakit", name: "MediaKit", enabled: true,
    chatModels: [], imageModels: [], videoModels: ["erase-video-subtitle-pro-v5"], audioModels: [] }];
  state.rules = [{ ...row, id: 1, provider: "volcengine-mediakit", model: "erase-video-subtitle-pro-v5",
    module: "video", currency: "CNY", unitType: "minute", unitPrice: "1" }];
  const file = await getFile();
  expect(file.drafts).toHaveLength(1);
  expect(file.drafts[0].rows).toEqual([{ unitType: "minute", price: "1", conditions: {} }]);
  state.rules = [];
  await roundtrip(file);
  expect(state.rules[0]).toMatchObject({ unitType: "minute", unitPrice: "1", currency: "CNY" });
});

it("retains missing-price information without inventing a zero price", () => {
  const file = exportCurrentPrices(state.settings, [{ provider: "p", model: "m", label: "missing", module: "image",
    key: "p/m", providerName: "P", enabled: true, historical: false, complete: false, rules: [],
    slots: [{ key: "2K", label: "2K", conditions: { resolution: "2K" }, unitType: "image", missing: "缺价格" }] }]);
  expect(file.drafts).toEqual([]);
  expect(file.missing).toEqual([{ provider: "p", model: "m", slot: "2K", reason: "缺价格" }]);
});

it.skipIf(!process.env.BILLING_MIGRATION_FIXTURE)("publishes the complete local snapshot into an isolated target and compares every price after re-export", async () => {
  const { file, catalog } = JSON.parse(readFileSync(process.env.BILLING_MIGRATION_FIXTURE!, "utf8"));
  const byProvider = new Map<string, any>();
  for (const m of catalog as BillingModel[]) {
    if (m.historical) continue;
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, { id: m.provider, name: m.providerName, enabled: true, chatModels: [], imageModels: [], videoModels: [], audioModels: [] });
    const list = byProvider.get(m.provider)[m.module === "agent" ? "chatModels" : `${m.module}Models`];
    if (list) list.push(m.model);
  }
  state.providers = [...byProvider.values()];
  state.rules = file.drafts.flatMap((d: any) => d.rows.map((r: any) => ({ provider: d.provider, model: d.model, module: d.module,
    displayName: d.label, currency: d.currency, unitType: r.unitType, unitPrice: "999", matchConditions: r.conditions,
    priority: 100, isActive: true, effectiveFrom: new Date("2020-01-01"), effectiveTo: null, notes: "target history" })));
  state.rules.forEach((r, i) => { r.id = i + 1; });
  const oldCount = state.rules.length;
  await roundtrip(file);
  expect(state.rules.slice(0, oldCount).every(r => r.unitPrice === "999" && +r.effectiveTo === +new Date("2026-10-01T16:00:00Z"))).toBe(true);
  const restored = await getBillingCatalog(state.settings, new Date(), db);
  const original = new Map((catalog as BillingModel[]).map(m => [`${m.provider}/${m.model}`, m]));
  for (const m of restored) for (const slot of m.slots) {
    const source = original.get(`${m.provider}/${m.model}`)?.slots.find(s => s.key === slot.key);
    if (source?.rule) expect([slot.rule?.unitPrice, slot.rule?.currency], `${m.model}/${slot.key}`).toEqual([source.rule.unitPrice, source.rule.currency]);
  }
});
