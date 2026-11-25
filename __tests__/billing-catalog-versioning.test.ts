import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rules: [] as any[],
  settings: { mode: "observe", revision: 0, rates: [] } as any,
  enabled: false,
}));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true }),
}));
vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: async () => [
    {
      id: "kie",
      name: "KIE",
      enabled: mocks.enabled,
      imageModels: ["nano-banana-pro"],
      videoModels: [],
      audioModels: [],
      chatModels: [],
    },
    {
      id: "volcengine-mediakit",
      name: "火山引擎 AI MediaKit",
      enabled: false,
      imageModels: [],
      videoModels: ["erase-video-subtitle-pro-v5", "other-video"],
      audioModels: [],
      chatModels: [],
    },
  ],
}));
vi.mock("@/lib/providers/model-availability", () => ({
  isProviderModelEnabled: (_: any, kind: string, id: string) =>
    mocks.enabled && kind === "image" && id === "nano-banana-pro",
}));
const db = {
  billingPriceRule: {
    findMany: vi.fn(async () => mocks.rules),
    updateMany: vi.fn(async ({ data, where }: any) => {
      for (const r of mocks.rules)
        if (
          r.provider === where.provider &&
          r.model === where.model &&
          (!where.id || where.id.in.includes(r.id)) &&
          +r.effectiveFrom < +where.effectiveFrom.lt &&
          (!r.effectiveTo || +r.effectiveTo > +data.effectiveTo)
        )
          r.effectiveTo = data.effectiveTo;
    }),
    createMany: vi.fn(async ({ data }: any) => {
      mocks.rules.push(
        ...data.map((r: any, i: number) => ({
          ...r,
          id: mocks.rules.length + i + 1,
        })),
      );
    }),
  },
  usageLedger: { groupBy: async () => [] },
  appSetting: {
    upsert: vi.fn(async ({ update }: any) => {
      mocks.settings = JSON.parse(update.value);
    }),
  },
};
vi.mock("@/lib/billing/settings", () => ({
  readBillingSettings: async () => structuredClone(mocks.settings),
  withBillingWrite: async (fn: any) => {
    const prior = structuredClone(mocks.rules);
    try {
      return await fn(db);
    } catch (e) {
      mocks.rules = prior;
      throw e;
    }
  },
}));
import { getBillingCatalog } from "@/lib/billing/catalog";
import { POST, GET } from "@/app/api/admin/billing/catalog/route";
import { validateDraft } from "@/lib/billing/drafts";
import { OPENROUTER_IMAGE_QUOTES } from "@/lib/billing/openrouter-pricing";
const request = (body: any) =>
  new Request("http://localhost/api/admin/billing/catalog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: mocks.settings.revision, ...body }),
  }) as any;
const prices = {
  action: "prices",
  provider: "kie",
  model: "nano-banana-pro",
  label: "Nano",
  module: "image",
  currency: "CNY",
  effectiveDate: "2026-10-01",
  rows: [{ conditions: {}, unitType: "image", price: "0.2" }],
};
beforeEach(() => {
  mocks.rules = [];
  mocks.settings = { mode: "observe", revision: 0, rates: [] };
  mocks.enabled = false;
  vi.clearAllMocks();
});
describe("catalog coverage and price write contracts", () => {
  const subtitlePrices = {
    ...prices,
    provider: "volcengine-mediakit",
    model: "erase-video-subtitle-pro-v5",
    label: "火山字幕擦除 · 精细化 V5",
    module: "video",
    rows: [{ conditions: {}, unitType: "minute", price: "1" }],
  };

  it("saves the subtitle minute price as a draft without publishing it", async () => {
    const response = await POST(request({ ...subtitlePrices, action: "saveDraft" }));
    expect(response.status).toBe(200);
    expect(mocks.settings.drafts).toEqual([validateDraft(subtitlePrices)]);
    expect(mocks.rules).toEqual([]);
    expect(mocks.settings.mode).toBe("observe");
    expect(mocks.settings.rates).toEqual([]);
  });

  it.each(["prices", "publishDraft", "publishDrafts"])("accepts subtitle minute pricing through %s", async (action) => {
    const draft = validateDraft(subtitlePrices);
    mocks.settings.drafts = [draft];
    const response = await POST(request({ ...subtitlePrices, action, draftId: draft.id }));
    expect(await response.json()).toMatchObject({ ok: true });
    expect(response.status).toBe(200);
    expect(mocks.rules).toHaveLength(1);
    expect(mocks.rules[0]).toMatchObject({
      provider: subtitlePrices.provider, model: subtitlePrices.model,
      currency: "CNY", unitType: "minute", unitPrice: "1",
    });
    expect(mocks.settings.drafts).toEqual([]);
    const model = (await getBillingCatalog(mocks.settings, new Date("2026-10-02"), db))
      .find(m => m.provider === subtitlePrices.provider && m.model === subtitlePrices.model);
    expect(model?.complete).toBe(true);
  });

  it("does not enable minute pricing for unrelated video models", async () => {
    const response = await POST(request({ ...subtitlePrices, model: "other-video" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "计费单位不适用于该模型" });
    expect(mocks.rules).toEqual([]);
  });

  it("imports supported entries while reporting unavailable and invalid entries individually", async () => {
    const response = await POST(request({ action: "importDrafts", file: {
      format: "inkvia-price-drafts-v1",
      drafts: [prices, { ...prices, model: "not-installed" }, { ...prices, rows: [{ conditions: {}, unitType: "image", price: "-1" }] }],
    } }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.importReport.items.map((item: any) => item.status)).toEqual(["imported", "skipped", "failed"]);
    expect(result.importReport.items[1].reason).toContain("未接入");
    expect(mocks.settings.drafts).toHaveLength(1);
    expect(mocks.rules).toEqual([]);
    expect(mocks.settings.rates).toEqual([]);
  });

  it("previews imports without writing and reports duplicate drafts separately", async () => {
    mocks.settings.drafts = [validateDraft(prices)];
    const before = structuredClone(mocks.settings);
    const file = { format: "inkvia-price-drafts-v1", drafts: [prices, { ...prices, notes: "second version" }] };
    const response = await POST(request({ action: "previewImport", file }));
    expect(response.status).toBe(200);
    expect((await response.json()).importReport.items.map((item: any) => item.status)).toEqual(["existing", "ready"]);
    expect(mocks.settings).toEqual(before);
    expect(db.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("exports every price version, pending draft and exchange rate regardless of catalog visibility", async () => {
    mocks.settings.drafts = [validateDraft({ ...prices, rows: [{ conditions: {}, unitType: "image", price: "" }] })];
    mocks.settings.rates = [{ id: "rate", provider: "kie", currency: "USD", rate: "7.2", effectiveFrom: "2026-01-01T00:00:00.000Z", notes: "conversion" }];
    mocks.rules = [false, true].map((isActive, index) => ({
      id: index + 1, provider: "kie", model: index ? "nano-banana-pro" : "retired-model", module: "image",
      displayName: "Version", matchConditions: { resolution: ["1K", "2K"] }, unitType: "image", unitPrice: "0",
      currency: "USD", priority: 100, isActive, effectiveFrom: new Date(`202${index}-01-01`),
      effectiveTo: index ? null : new Date("2021-01-01"), notes: "original notes",
    }));
    const response = await GET({ nextUrl: new URL("http://localhost/api/admin/billing/catalog?export=all") } as any);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const file = await response.json();
    expect(file.format).toBe("inkvia-prices-v2");
    expect(file.prices).toHaveLength(2);
    expect(file.prices[0]).toMatchObject({ model: "retired-model", isActive: false, unitPrice: "0", notes: "original notes" });
    expect(file.drafts).toEqual(mocks.settings.drafts);
    expect(file.rates).toEqual(mocks.settings.rates);
    const rulesBefore = structuredClone(mocks.rules);
    mocks.settings.rates = [];
    const imported = await POST(request({ action: "importDrafts", file }));
    expect(imported.status).toBe(200);
    const result = await imported.json();
    expect(result.importReport.items.some((item: any) => item.model === "retired-model" && item.status === "skipped")).toBe(true);
    expect(mocks.settings.drafts).toHaveLength(2);
    expect(mocks.settings.drafts.find((draft: any) => draft.currency === "USD")).toMatchObject({
      rows: [{ conditions: { resolution: ["1K", "2K"] }, unitType: "image", price: "0" }],
      sourceVersion: { effectiveFrom: "2021-01-01T00:00:00.000Z", effectiveTo: null, isActive: true, priority: 100 },
    });
    expect(mocks.settings.rateDrafts).toHaveLength(1);
    expect(mocks.settings.rateDrafts[0]).toMatchObject({ provider: "kie", currency: "USD", rate: "7.2", notes: "conversion" });
    expect(mocks.settings.rates).toEqual([]);
    expect(mocks.rules).toEqual(rulesBefore);
    const repeated = await POST(request({ action: "importDrafts", file }));
    expect((await repeated.json()).importReport.items.every((item: any) => ["existing", "skipped"].includes(item.status))).toBe(true);
    expect(mocks.settings.drafts).toHaveLength(2);
    expect(mocks.settings.rateDrafts).toHaveLength(1);
  });

  it("exports all 61 models across providers even when only 10 pending drafts exist", async () => {
    mocks.settings.drafts = Array.from({ length: 10 }, (_, index) => validateDraft({ ...prices, notes: `Draft ${index}` }));
    mocks.settings.rateDrafts = [{ id: "pending-rate", provider: "kie", currency: "USD", rate: "7", effectiveFrom: "2026-01-01T00:00:00.000Z" }];
    mocks.rules = Array.from({ length: 61 }, (_, index) => ({
      id: index + 1, provider: index % 2 ? "kie" : "other-provider", model: `model-${index}`, module: "image",
      displayName: `Model ${index}`, matchConditions: { resolution: "2K" }, unitType: "image", unitPrice: `${index}.25`,
      currency: "CNY", priority: 100, isActive: index % 3 !== 0,
      effectiveFrom: new Date(index % 3 === 1 ? "2030-01-01" : "2020-01-01"),
      effectiveTo: index % 3 === 0 ? new Date("2021-01-01") : null, notes: `Price ${index}`,
    }));
    const before = structuredClone(mocks.settings);
    const response = await GET({ nextUrl: new URL("http://localhost/api/admin/billing/catalog?export=all") } as any);
    expect(response.status).toBe(200);
    expect(db.billingPriceRule.findMany).toHaveBeenCalledWith({
      orderBy: [{ provider: "asc" }, { model: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }],
    });
    const file = await response.json();
    expect(file.prices).toHaveLength(61);
    expect(file.prices).toEqual(mocks.rules.map(({ id, effectiveFrom, effectiveTo, ...rule }) => ({
      ...rule, effectiveFrom: effectiveFrom.toISOString(), effectiveTo: effectiveTo?.toISOString() ?? null,
    })));
    expect(file.drafts).toEqual(before.drafts);
    expect(file.rateDrafts).toEqual(before.rateDrafts);
    expect(file.rates).toEqual(before.rates);
    expect(mocks.settings).toEqual(before);
    expect(db.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("publishes imported conversion drafts only after choosing a new effective date", async () => {
    mocks.settings.rateDrafts = [{ id: "pending", provider: "kie", currency: "USD", rate: "7.2", effectiveFrom: "2020-01-01T00:00:00.000Z", notes: "source" }];
    mocks.settings.drafts = [validateDraft({ ...prices, currency: "USD" })];
    const result = await POST(request({ action: "publishDrafts", effectiveDate: "2026-10-01" }));
    expect(result.status).toBe(200);
    expect((await result.json()).published).toMatchObject({ models: 1, rows: 1, rates: 1 });
    expect(mocks.settings.rates[0]).toMatchObject({ currency: "USD", rate: "7.2", effectiveFrom: "2026-09-30T16:00:00.000Z" });
    expect(mocks.settings.rateDrafts).toEqual([]);
    expect(mocks.settings.drafts).toEqual([]);
    expect(mocks.rules[0].effectiveFrom.toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });

  it("keeps conversion conflicts pending and rolls back conversions when price publication fails", async () => {
    const rate = { id: "pending", provider: "kie", currency: "USD", rate: "7.2", effectiveFrom: "2020-01-01T00:00:00.000Z", notes: "source" };
    mocks.settings.rateDrafts = [rate, { ...rate, id: "second", rate: "7.1" }];
    expect((await POST(request({ action: "publishDrafts", effectiveDate: "2026-10-01" }))).status).toBe(400);
    expect(mocks.settings.rates).toEqual([]);
    mocks.settings.rateDrafts = [rate];
    mocks.settings.drafts = [validateDraft({ ...prices, rows: [{ conditions: {}, unitType: "unknown-unit", price: "1" }] })];
    expect((await POST(request({ action: "publishDrafts", effectiveDate: "2026-10-01" }))).status).toBe(400);
    expect(mocks.settings.rates).toEqual([]);
    expect(mocks.settings.rateDrafts).toEqual([rate]);
    expect(mocks.rules).toEqual([]);
  });

  it("imports more than the old 100-draft limit and preserves blank and free prices", async () => {
    const drafts = Array.from({ length: 101 }, (_, i) => ({ ...prices, notes: String(i), rows: [
      { conditions: { resolution: "1K" }, unitType: "image", price: "0" },
      { conditions: { resolution: "2K" }, unitType: "image", price: "" },
    ] }));
    const response = await POST(request({ action: "importDrafts", file: { format: "inkvia-price-drafts-v1", drafts } }));
    expect(response.status).toBe(200);
    expect(mocks.settings.drafts).toHaveLength(101);
    expect((await response.json()).importReport.items.every((item: any) => item.status === "imported" && item.filledRows === 1 && item.missingRows === 1)).toBe(true);
  });

  it("reports all skipped and malformed files without modifying settings", async () => {
    const file = { format: "inkvia-price-drafts-v1", drafts: [{ ...prices, model: "unavailable" }] };
    expect((await POST(request({ action: "importDrafts", file }))).status).toBe(200);
    expect(db.appSetting.upsert).not.toHaveBeenCalled();
    expect((await POST(request({ action: "importDrafts", file: { format: "inkvia-prices-v2", drafts: [prices] } }))).status).toBe(400);
    expect(mocks.settings.revision).toBe(0);
    expect(mocks.settings.drafts).toBeUndefined();
  });

  it("bulk publishes only filled rows, including zero, preserving blank tariffs and other models", async () => {
    const old = (id: number, resolution: string, model = "nano-banana-pro") => ({ id, provider: "kie", model, module: "image", currency: "CNY", unitType: "image", unitPrice: "1", matchConditions: { resolution }, effectiveFrom: new Date("2026-09-01"), effectiveTo: null, isActive: true, priority: 100 });
    mocks.rules = [old(1,"1K"),old(2,"2K"),old(3,"1K","other")];
    mocks.settings.drafts = [validateDraft({ ...prices, rows: [
      { conditions: {resolution:"1K"},unitType:"image",price:"0" },
      { conditions: {resolution:"2K"},unitType:"image",price:"" },
    ]})];
    const response = await POST(request({action:"publishDrafts",effectiveDate:"2026-10-01"}));
    expect(response.status).toBe(200);
    expect((await response.json()).published).toMatchObject({models:1,rows:1});
    expect(mocks.rules[0].effectiveTo).toEqual(new Date("2026-10-01T00:00:00+08:00"));
    expect(mocks.rules[1].effectiveTo).toBeNull();
    expect(mocks.rules[2].effectiveTo).toBeNull();
    expect(mocks.rules[3].unitPrice).toBe("0");
    expect(mocks.settings.drafts[0].rows).toEqual([{conditions:{resolution:"2K"},unitType:"image",price:""}]);
  });
  it("rolls back all bulk changes if a later model has an invalid tariff", async () => {
    mocks.settings.drafts = [validateDraft(prices), validateDraft({...prices, provider: "google-ai-studio", model:"gemini-3.1-flash-image", rows: [{ conditions: {}, unitType: "image", price: "1" }]})];
    const response = await POST(request({action:"publishDrafts",effectiveDate:"2026-10-01"}));
    expect(response.status).toBe(400);
    expect(mocks.rules).toEqual([]);
    expect(mocks.settings.revision).toBe(0);
    expect(mocks.settings.drafts).toHaveLength(2);
  });
  it("does not guess between multiple drafts of one model", async () => {
    mocks.settings.drafts = [validateDraft(prices), validateDraft({...prices,notes:"alternate"})];
    const response = await POST(request({action:"publishDrafts",effectiveDate:"2026-10-01"}));
    expect(response.status).toBe(400);
    expect(mocks.rules).toEqual([]);
  });
  it("rejects stale bulk submissions and same-date overwrites", async () => {
    mocks.settings.drafts = [validateDraft(prices)];
    expect((await POST(request({action:"publishDrafts",effectiveDate:"2026-10-01",revision:-1}))).status).toBe(400);
    expect(mocks.rules).toEqual([]);
    expect((await POST(request(prices))).status).toBe(200);
    const prior = structuredClone(mocks.rules);
    expect((await POST(request({action:"publishDrafts",effectiveDate:"2026-10-01"}))).status).toBe(400);
    expect(mocks.rules).toEqual(prior);
  });
  it("imports drafts idempotently without changing active prices or mode", async () => {
    const file = {
      format: "inkvia-price-drafts-v1",
      drafts: [{ ...prices, currency: "CNY", rows: prices.rows }],
    };
    expect((await POST(request({ action: "importDrafts", file }))).status).toBe(
      200,
    );
    expect((await POST(request({ action: "importDrafts", file }))).status).toBe(
      200,
    );
    expect(mocks.settings.drafts).toHaveLength(1);
    const exported = await GET({
      nextUrl: new URL(
        "http://localhost/api/admin/billing/catalog?export=drafts",
      ),
    } as any);
    expect(exported.headers.get("content-disposition")).toContain("attachment");
    const fileContent = await exported.json();
    expect(Object.keys(fileContent)).toEqual(["format", "drafts"]);
    expect(fileContent.drafts).toHaveLength(1);
    expect(mocks.settings.mode).toBe("observe");
    expect(mocks.rules).toHaveLength(0);
    expect(
      (
        await POST(
          request({
            action: "publishDraft",
            draftId: mocks.settings.drafts[0].id,
            effectiveDate: "",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rules).toHaveLength(0);
    expect(
      (
        await POST(
          request({
            action: "publishDraft",
            draftId: mocks.settings.drafts[0].id,
            effectiveDate: "2026-10-01",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rules).toHaveLength(1);
  });
  it("rejects overlapping tariff arrays and inappropriate units", async () => {
    expect(
      (
        await POST(
          request({
            ...prices,
            rows: [
              {
                conditions: { resolution: ["1K", "2K"] },
                unitType: "image",
                price: "1",
              },
              {
                conditions: { resolution: ["2K", "4K"] },
                unitType: "image",
                price: "2",
              },
            ],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            ...prices,
            rows: [
              { conditions: {}, unitType: "input_million_token", price: "1" },
            ],
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rules).toHaveLength(0);
  });
  it("allows missing historical exchange rates without overwriting existing periods", async () => {
    const rate = {
      action: "rate",
      provider: "kie",
      currency: "USD",
      rate: "7.2",
    };
    expect(
      (await POST(request({ ...rate, effectiveDate: "2026-09-01" }))).status,
    ).toBe(200);
    expect(
      (await POST(request({ ...rate, effectiveDate: "2026-01-01" }))).status,
    ).toBe(200);
    expect(
      (await POST(request({ ...rate, effectiveDate: "2026-06-01" }))).status,
    ).toBe(400);
    expect(
      (await POST(request({ ...rate, effectiveDate: "2026-09-01" }))).status,
    ).toBe(400);
    expect(mocks.settings.rates).toHaveLength(2);
  });
  it("shows unpriced models before any rule exists", async () => {
    const catalog = await getBillingCatalog(
      mocks.settings,
      new Date("2026-09-22"),
      db,
    );
    const model = catalog.find(
      (m) => m.model === "nano-banana-pro" && m.provider === "kie",
    )!;
    expect(model.complete).toBe(false);
    expect(model.slots.map((s) => s.conditions.resolution)).toEqual([
      "1K",
      "2K",
      "4K",
    ]);
  });
  it("does not declare a partial resolution table complete", async () => {
    mocks.rules = [
      {
        id: 1,
        provider: "kie",
        model: "nano-banana-pro",
        unitType: "image",
        unitPrice: 1,
        currency: "CNY",
        priority: 1,
        isActive: true,
        effectiveFrom: new Date("2020-01-01"),
        matchConditions: { resolution: ["1K", "2K"] },
      },
    ];
    const model = (
      await getBillingCatalog(mocks.settings, new Date("2026-09-22"), db)
    ).find((m) => m.model === "nano-banana-pro" && m.provider === "kie")!;
    expect(
      model.slots.filter((s) => s.missing).map((s) => s.conditions.resolution),
    ).toEqual(["4K"]);
  });
  it("requires a date and explicit prices", async () => {
    expect((await POST(request({ ...prices, effectiveDate: "" }))).status).toBe(
      400,
    );
    expect(
      (
        await POST(
          request({ ...prices, rows: [{ unitType: "image", price: "" }] }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rules).toHaveLength(0);
  });
  it("creates a new version and preserves the earlier version", async () => {
    expect((await POST(request(prices))).status).toBe(200);
    expect(
      (
        await POST(
          request({
            ...prices,
            effectiveDate: "2026-11-01",
            rows: [{ conditions: {}, unitType: "image", price: "0.25" }],
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rules).toHaveLength(2);
    expect(mocks.rules[0].unitPrice).toBe("0.2");
    expect(mocks.rules[0].effectiveTo.toISOString()).toBe(
      "2026-10-31T16:00:00.000Z",
    );
    expect(mocks.rules[1].unitPrice).toBe("0.25");
  });
  it("rejects stale editors and duplicate effective dates", async () => {
    await POST(request(prices));
    expect((await POST(request({ ...prices, revision: 0 }))).status).toBe(400);
    expect((await POST(request(prices))).status).toBe(400);
    expect(mocks.rules).toHaveLength(1);
  });
  it("rolls back an incomplete model save", async () => {
    const r = await POST(
      request({
        ...prices,
        rows: [
          { conditions: { resolution: "1K" }, unitType: "image", price: "1" },
        ],
      }),
    );
    expect(r.status).toBe(400);
    expect(mocks.rules).toHaveLength(0);
  });
  it("accepts the complete Google image token tariff and rejects missing output pricing", async () => {
    const payload = { ...prices, provider: "google-ai-studio", model: "gemini-3.1-flash-image", module: "image", currency: "CNY", rows: [
      { conditions: {}, unitType: "input_million_token", price: "3.5" },
      { conditions: {}, unitType: "text_output_million_token", price: "21" },
      { conditions: {}, unitType: "image_output_million_token", price: "420" },
    ] };
    expect((await POST(request({ ...payload, rows: payload.rows.slice(0, 2) }))).status).toBe(400);
    expect((await POST(request(payload))).status).toBe(200);
    expect(mocks.rules).toHaveLength(3);
  });
  it("requires the actual supplier's exchange rate", async () => {
    const r = await POST(request({ ...prices, currency: "USD" }));
    expect(r.status).toBe(400);
    expect(mocks.rules).toHaveLength(0);
    expect(
      (
        await POST(
          request({
            action: "rate",
            provider: "kie",
            currency: "USD",
            rate: "7.2",
            effectiveDate: "2026-01-01",
          }),
        )
      ).status,
    ).toBe(200);
    expect((await POST(request({ ...prices, currency: "USD" }))).status).toBe(
      200,
    );
  });
  it("does not allow strict admission until enabled models are complete now", async () => {
    mocks.enabled = true;
    expect(
      (await POST(request({ action: "mode", mode: "strict" }))).status,
    ).toBe(400);
    expect(mocks.settings.mode).toBe("observe");
    await POST(request({ ...prices, effectiveDate: "2020-01-01" }));
    expect(
      (await POST(request({ action: "mode", mode: "strict" }))).status,
    ).toBe(200);
  });
});


it.each(["gpt-image-2.5-sunburst-openrouter", "gpt-image-2-openrouter", "gemini-3-pro-image-openrouter", "gpt-image-2.5-flare-openrouter"])("imports and publishes the CNY OpenRouter draft for %s without an exchange rate", async (model) => {
  const draft = validateDraft({ provider: "openrouter", model, module: "image", label: model, currency: "CNY", notes: "1 USD = 7 CNY", rows: [{ conditions: {}, unitType: "provider_usd", price: "7" }] });
  const imported = await POST(request({ action: "importDrafts", file: { format: "inkvia-price-drafts-v1", drafts: [draft] } }));
  expect(imported.status).toBe(200);
  expect(mocks.settings.drafts).toEqual([draft]);
  const published = await POST(request({ action: "publishDraft", draftId: draft.id, effectiveDate: "2026-10-01" }));
  expect(await published.json()).not.toHaveProperty("error");
  expect(published.status).toBe(200);
  expect(mocks.rules).toHaveLength(1);
  expect(mocks.rules[0]).toMatchObject({ provider: "openrouter", model, currency: "CNY", unitType: "provider_usd", unitPrice: "7" });
  expect(mocks.settings.rates).toEqual([]);
});

it.each(Object.keys(OPENROUTER_IMAGE_QUOTES))("publishes visible OpenRouter tariffs alongside actual-cost settlement for %s", async (model) => {
  const rows = [...OPENROUTER_IMAGE_QUOTES[model].map(r => ({ conditions: {}, unitType: r.unitType, price: String(Number(r.usd) * 7) })), { conditions: {}, unitType: "provider_usd", price: "7" }];
  const published = await POST(request({ action: "prices", provider: "openrouter", model, module: "image", currency: "CNY", effectiveDate: "2026-09-30", rows }));
  expect(await published.json()).not.toHaveProperty("error");
  expect(published.status).toBe(200);
  const catalog = (await getBillingCatalog(mocks.settings, new Date("2026-09-30T12:00:00Z"), db)).find(m => m.provider === "openrouter" && m.model === model)!;
  expect(catalog.complete).toBe(true);
  expect(catalog.slots).toHaveLength(rows.length);
  for (const row of rows) expect(catalog.slots.find(s => s.unitType === row.unitType)?.rule).toMatchObject({ unitType: row.unitType, unitPrice: row.price, currency: "CNY" });
});
