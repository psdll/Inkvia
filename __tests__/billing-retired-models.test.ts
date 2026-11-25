import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import { getBillingCatalog } from "@/lib/billing/catalog";
import { EMPTY_BILLING_SETTINGS } from "@/lib/billing/money";
import { readBillingSettings } from "@/lib/billing/settings";
import { DEFAULT_PRICE_RULES } from "@/lib/billing/default-prices";
import { validateDraft } from "@/lib/billing/drafts";

const removed = [
  ["kie", "nano-banana-2", "image"],
  ["kie", "nano-banana-2-lite", "image"],
  ["kie", "gemini-omni-video", "video"],
  ["kie", "grok-video-1.5", "video"],
  ["kie", "grok-imagine-video-1-5-preview", "video"],
  ["easyrouter", "gpt-image-2", "image"],
  ["easyrouter", "image 2", "image"],
  ["easyrouter", "gpt-5.5", "agent"],
  ["easyrouter", "gemini-3-flash-preview", "agent"],
  ["easyrouter", "fetched-model", "agent"],
  ["jiekou", "gpt-image-2-jiekou", "image"],
  ["reapi", "deepseek-v4-flash", "agent"],
  ["reapi", "deepseek-v4-pro", "agent"],
  ["reapi", "gpt-5.5", "agent"],
  ["reapi", "gpt-5.6-sol", "agent"],
  ["reapi", "gpt-image-2-official", "image"],
  ["reapi", "gpt-image-2-official-reapi", "image"],
  ["custom-gpt-image-2-official", "gpt-image-2-official", "image"],
  ["volcengine", "doubao-seedance-1-5-pro-251215", "video"],
  ["volcengine", "doubao-seedance-1-0-pro-250528", "video"],
  ["aicoming-haiya", "minimax-h3-aicoming-haiya", "video"],
];

describe("retired models in price configuration", () => {
  it("removes KIE Nano Banana 2 drafts and defaults while retaining other image prices", async () => {
    const ids = ["nano-banana-2", "nano-banana-2-lite"];
    const draft = (provider: string, model: string) => validateDraft({ provider, model, module: "image", currency: "CNY", rows: [{ conditions: {}, unitType: "image", price: "1" }] });
    const retained = [draft("kie", "nano-banana-pro"), draft("kie", "gpt-image-2"), draft("other-platform", ids[0])];
    const settings = { ...EMPTY_BILLING_SETTINGS, revision: 11, drafts: [...ids.map(id => draft("kie", id)), ...retained] };
    const db = { appSetting: { findUnique: vi.fn().mockResolvedValue({ value: JSON.stringify(settings) }) } };
    expect(await readBillingSettings(db)).toEqual({ ...settings, drafts: retained });
    expect(DEFAULT_PRICE_RULES.some(rule => rule.provider === "kie" && ids.includes(rule.model))).toBe(false);
    expect(DEFAULT_PRICE_RULES.some(rule => rule.provider === "google-ai-studio" && rule.model === "gemini-3.1-flash-lite-image")).toBe(true);
  });
  it("drops all EasyRouter drafts while preserving accounting settings and other providers", async () => {
    const draft = (provider: string, model: string) => validateDraft({ provider, model, module: "agent", currency: "CNY", rows: [{ conditions: {}, unitType: "input_million_token", price: "1" }] });
    const retained = [draft("apimart", "gpt-5.5"), draft("custom-other", "gemini-3-flash-preview")];
    const settings = { ...EMPTY_BILLING_SETTINGS, revision: 10, drafts: [draft("easyrouter", "gpt-5.5"), draft("easyrouter", "gemini-3-flash-preview"), draft("easyrouter", "fetched-model"), ...retained] };
    const db = { appSetting: { findUnique: vi.fn().mockResolvedValue({ value: JSON.stringify(settings) }) } };
    expect(await readBillingSettings(db)).toEqual({ ...settings, drafts: retained });
    expect(settings.drafts).toHaveLength(5);
  });
  it("excludes saved KIE video drafts without changing images or other providers", async () => {
    const draft = (provider: string, model: string, module = "video") => validateDraft({ provider, model, module, currency: "CNY", rows: [{ conditions: {}, unitType: module === "video" ? "video" : "image", price: "1" }] });
    const retained = [draft("kie", "gpt-image-2", "image"), draft("other-platform", "gemini-omni-video")];
    const settings = { ...EMPTY_BILLING_SETTINGS, revision: 9, drafts: [draft("kie", "gemini-omni-video"), draft("kie", "grok-video-1.5"), ...retained] };
    const db = { appSetting: { findUnique: vi.fn().mockResolvedValue({ value: JSON.stringify(settings) }) } };
    expect(await readBillingSettings(db)).toEqual({ ...settings, drafts: retained });
  });
  it("removes only retired Volcengine drafts from saved settings and default prices", async () => {
    const retired = ["doubao-seedance-1-0-pro-250528", "doubao-seedance-1-5-pro-251215"];
    const draft = (provider: string, model: string) => validateDraft({
      provider, model, module: "video", currency: "CNY",
      rows: [{ conditions: {}, unitType: "million_token", price: "15" }],
    });
    const retained = [draft("volcengine", "doubao-seedance-2-0-260128"), draft("other-platform", retired[0]), draft("jiekou", "gpt-image-2")];
    const saved = { ...EMPTY_BILLING_SETTINGS, revision: 7, drafts: [...retired.map(model => draft("volcengine", model)), ...retained] };
    const db = { appSetting: { findUnique: vi.fn().mockResolvedValue({ value: JSON.stringify(saved) }) } };
    expect(await readBillingSettings(db)).toEqual({ ...saved, drafts: retained });
    expect(saved.drafts).toHaveLength(5);
    expect(DEFAULT_PRICE_RULES.some(rule => rule.provider === "volcengine" && retired.includes(rule.model))).toBe(false);
  });

  it.each(["rules", "history"])("does not restore removed models from %s", async (source) => {
    const rows = [...removed, ["custom-other", "gpt-5.5", "agent"], ["custom-other", "old-model", "image"]]
      .map(([provider, model, module], id) => ({
        id, provider, externalProvider: provider, model, module,
        unitType: module === "agent" ? "input_million_token" : "image",
        unitPrice: 1, currency: "CNY", matchConditions: {}, priority: 0,
        isActive: true, effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
      }));
    const snapshot = structuredClone(rows);
    const db = {
      appSetting: { findUnique: vi.fn().mockResolvedValue({ value: JSON.stringify([{
        id: "custom-other", name: "Other", protocol: "openai", baseUrl: "https://example.test/v1",
        enabled: true, egressMode: "direct", imageModels: [], videoModels: [], chatModels: ["gpt-5.5"],
      }]) }) },
      billingPriceRule: { findMany: vi.fn().mockResolvedValue(source === "rules" ? rows : []) },
      usageLedger: { groupBy: vi.fn().mockResolvedValue(source === "history" ? rows : []) },
    };
    const catalog = await getBillingCatalog(EMPTY_BILLING_SETTINGS, new Date(), db);
    for (const [provider, model] of removed) {
      expect(catalog.some((m) => m.provider === provider && m.model === model), `${provider}/${model}`).toBe(false);
    }
    expect(catalog.some((m) => m.provider === "custom-other" && m.model === "gpt-5.5")).toBe(true);
    expect(catalog.some((m) => m.provider === "custom-other" && m.model === "old-model")).toBe(false);
    expect(catalog.some((m) => m.historical)).toBe(false);
    expect(db.usageLedger.groupBy).not.toHaveBeenCalled();
    expect(catalog.filter((m) => m.provider === "reapi").map((m) => m.model)).toEqual(expect.arrayContaining(["midjourney-v8-reapi", "gpt-image-2.5-reapi"]));
    expect(rows).toEqual(snapshot);
    const direct = await getBillingCatalog(EMPTY_BILLING_SETTINGS, new Date(), db, { provider: "jiekou", model: "gpt-image-2-jiekou" });
    expect(direct).toEqual([]);
  });
});
