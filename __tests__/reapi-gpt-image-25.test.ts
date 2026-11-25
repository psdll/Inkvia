import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
import { REAPI_GPT_IMAGE_25_MODEL_ID, REAPI_GPT_IMAGE_25_LABEL, REAPI_GPT_IMAGE_25_UPSTREAM_MODELS } from "@/lib/gpt-image-25-models";
import { REAPI_GPT_IMAGE_25_RATIOS, buildReapiGptImage25Request, mapReapiGptImage25Pixels } from "@/lib/reapi-gpt-image-25";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getImageModelParams, normalizeImageQuality } from "@/lib/generation/image-model-params";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import { REAPI_GPT_IMAGE_25_PRICE_RULES } from "@/lib/reapi-gpt-image-25-pricing";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";

describe("reAPI GPT Image 2.5", () => {
  it("upgrades saved standard capabilities without changing credentials or provider state", () => {
    const base = getBuiltinProviders().find((p) => p.id === "reapi")!;
    const merged = mergeSavedProvidersWithBuiltins([{ ...base, enabled: true, apiKey: "saved-key", imageModels: ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "midjourney"] }]);
    expect(merged.find((p) => p.id === "reapi")).toMatchObject({ enabled: true, apiKey: "saved-key", imageModels: ["gpt-image-2.5-flare-official", "gpt-image-2.5-sunburst-official", "midjourney"] });
    expect(isProviderModelEnabled(merged, "image", REAPI_GPT_IMAGE_25_MODEL_ID)).toBe(true);
  });

  it.each(["flare", "sunburst"])("does not apply historical standard prices to official %s", async (mode) => {
    const providerModel = `gpt-image-2.5-${mode}-official`;
    const db = { billingPriceRule: { findMany: vi.fn(async ({ where }) => REAPI_GPT_IMAGE_25_PRICE_RULES.filter((rule) => where.model.in.includes(rule.model))) }, usageLedger: { upsert: vi.fn(async ({ create }) => create) } };
    const ledger = await upsertUsageLedgerForGeneration({ id: 25, userId: "7", authUserId: 7, type: "image_edit", source: "tool", prompt: "photo", templateData: JSON.stringify({ model: REAPI_GPT_IMAGE_25_MODEL_ID, providerModel, outputCount: 1 }), model: REAPI_GPT_IMAGE_25_MODEL_ID, status: "success", externalProvider: "reapi", externalTaskId: "task_25", errorMsg: null, finishedAt: new Date(), createdAt: new Date() }, db);
    expect(ledger).toMatchObject({ providerModel, costStatus: "unpriced", billable: true });
  });

  it.each(["flare", "sunburst"] as const)("builds exact official-channel %s text and reference requests", (mode) => {
    const input = { prompt: " product ", mode, quality: "max", resolution: "4K", aspectRatio: "9:16" };
    const request = { endpoint: "/images/generations", body: { model: `gpt-image-2.5-${mode}-official`, prompt: "product", size: "2160x3840", quality: "max", n: 1 } };
    expect(buildReapiGptImage25Request(input)).toEqual(request);
    const imageUrls = ["https://example.com/first.png", "https://example.com/second.jpg"];
    expect(buildReapiGptImage25Request({ ...input, imageUrls })).toEqual({ ...request, body: { ...request.body, image_urls: imageUrls } });
    for (const key of ["async", "resolution", "image", "mode", "response_format", "background", "output_format", "input_fidelity"]) expect(request.body).not.toHaveProperty(key);
  });

  it.each(["low", "medium", "high", "xhigh", "max"])("preserves %s through shared parameters and Agent validation", (quality) => {
    expect(normalizeImageQuality(REAPI_GPT_IMAGE_25_MODEL_ID, quality)).toBe(quality);
    for (const mode of ["flare", "sunburst"]) {
      const parsed = createImageTaskSchema.parse({ prompt: "photo", model: REAPI_GPT_IMAGE_25_MODEL_ID, quality, gptImage25Mode: mode });
      expect(buildReapiGptImage25Request({ prompt: parsed.prompt, quality: parsed.quality, mode: parsed.gptImage25Mode }).body).toMatchObject({ model: `gpt-image-2.5-${mode}-official`, quality });
    }
  });

  it.each(["1K", "2K", "4K"])("maps all fifteen %s ratios within documented custom-size limits", (resolution) => {
    for (const ratio of REAPI_GPT_IMAGE_25_RATIOS) {
      const [w, h] = mapReapiGptImage25Pixels(ratio, resolution).split("x").map(Number);
      expect(w % 16).toBe(0); expect(h % 16).toBe(0);
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
      expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(3);
      expect(w * h).toBeGreaterThanOrEqual(655360); expect(w * h).toBeLessThanOrEqual(8294400);
      const [rw, rh] = ratio.split(":").map(Number);
      expect(Math.abs(w / h - rw / rh) / (rw / rh)).toBeLessThan(0.02);
    }
  });

  it("enforces exact-model prompt and reference boundaries before submission", () => {
    const imageUrls = Array.from({ length: 16 }, (_, i) => `https://example.com/${i}.png`);
    expect(buildReapiGptImage25Request({ prompt: "x".repeat(32000), imageUrls }).body.image_urls).toEqual(imageUrls);
    expect(() => buildReapiGptImage25Request({ prompt: "x".repeat(32001) })).toThrow(/32000/);
    expect(() => buildReapiGptImage25Request({ prompt: "photo", imageUrls: [...imageUrls, "https://example.com/17.png"] })).toThrow(/16/);
    expect(() => buildReapiGptImage25Request({ prompt: "photo", imageUrls: ["data:image/png;base64,aW1hZ2U="] })).toThrow(/HTTP/);
    expect(() => buildReapiGptImage25Request({ prompt: "photo", quality: "ultra" })).toThrow(/画质/);
    expect(() => buildReapiGptImage25Request({ prompt: "photo", mode: "official" })).toThrow(/模式/);
  });

  it("exposes one entry with five Chinese qualities and preserves a disabled provider", () => {
    const entries = IMAGE_EDIT_MODEL_DEFINITIONS.filter((model) => model.provider === "reapi" && model.id.includes("2.5"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: REAPI_GPT_IMAGE_25_MODEL_ID, label: REAPI_GPT_IMAGE_25_LABEL, upstreamModelIds: Object.values(REAPI_GPT_IMAGE_25_UPSTREAM_MODELS) });
    const base = getBuiltinProviders().find((provider) => provider.id === "reapi")!;
    const merged = mergeSavedProvidersWithBuiltins([{ ...base, enabled: false, imageModels: ["gpt-image-2-official"] }]);
    expect(merged.find((p) => p.id === "reapi")?.imageModels).toEqual(expect.arrayContaining(Object.values(REAPI_GPT_IMAGE_25_UPSTREAM_MODELS)));
    expect(isProviderModelEnabled(merged, "image", REAPI_GPT_IMAGE_25_MODEL_ID)).toBe(false);
    expect(getImageModelParams(REAPI_GPT_IMAGE_25_MODEL_ID).qualities.map((option) => option.label)).toEqual(["低", "标准", "高", "超高", "极致"]);
    expect(getImageModelParams(REAPI_GPT_IMAGE_25_MODEL_ID).aspectRatios).toHaveLength(15);
  });

  it.each(["flare", "sunburst"] as const)("bills standard-channel %s per local single-image task regardless of quality or size", async (mode) => {
    const providerModel = `gpt-image-2.5-${mode}`;
    const db = { billingPriceRule: { findMany: vi.fn(async ({ where }) => REAPI_GPT_IMAGE_25_PRICE_RULES.filter((rule) => where.model.in.includes(rule.model))) }, usageLedger: { upsert: vi.fn(async ({ create }) => create) } };
    for (const [quality, resolution] of [["low", "1K"], ["max", "4K"]]) {
      const ledger = await upsertUsageLedgerForGeneration({ id: 25, userId: "7", authUserId: 7, type: "image_edit", source: "tool", prompt: "photo", templateData: JSON.stringify({ model: REAPI_GPT_IMAGE_25_MODEL_ID, providerModel, quality, resolution, outputCount: 1 }), model: REAPI_GPT_IMAGE_25_MODEL_ID, status: "success", externalProvider: "reapi", externalTaskId: "task_25", errorMsg: null, finishedAt: new Date("2026-09-09T00:01:00Z"), createdAt: new Date("2026-09-09T00:00:00Z") }, db);
      expect(ledger).toMatchObject({ providerModel, currency: "CNY", costStatus: "priced" });
      expect(ledger.amount.toNumber()).toBe(mode === "flare" ? 0.1296 : 0.1656);
      expect(ledger.unitCount.toNumber()).toBe(1);
    }
  });
});
