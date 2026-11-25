import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
import { AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID, AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS } from "@/lib/aicoming-merchant-models";
import { AICOMING_GPT_IMAGE_25_RATIOS, buildAicomingHaiyaGptImage25Request, mapAicomingGptImage25Pixels } from "@/lib/aicoming-gpt-image-25";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import { getImageModelParams, normalizeImageQuality } from "@/lib/generation/image-model-params";
import { AICOMING_HAIYA_GPT_IMAGE_25_PRICE_RULES } from "@/lib/aicoming-merchant-pricing";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";

describe("Haiya GPT Image 2.5 integration", () => {
  it.each(["flare", "sunburst"] as const)("builds exact %s generation and reference-edit payloads", (mode) => {
    const input = { prompt: " product ", mode, quality: "high", resolution: "4K", aspectRatio: "9:16", requestKey: "haiya-idempotent" };
    const request = { endpoint: "/images/generations", idempotencyKey: "haiya-idempotent", body: { model: AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS[mode], prompt: "product", size: "2160x3840", quality: "high", n: 1 } };
    expect(buildAicomingHaiyaGptImage25Request(input)).toEqual(request);
    const imageUrls = ["https://example.com/first.png", "https://example.com/second.jpg"];
    expect(buildAicomingHaiyaGptImage25Request({ ...input, imageUrls })).toEqual({ ...request, body: { ...request.body, image: imageUrls } });
  });

  it("does not copy APIMart resolution, image_urls, auto size, or hidden fields", () => {
    expect(buildAicomingHaiyaGptImage25Request({ prompt: "photo" }).body).toEqual({ model: "gpt-image-2.5-flare", prompt: "photo", size: "2048x2048", quality: "medium", n: 1 });
    expect(buildAicomingHaiyaGptImage25Request({ prompt: "photo" }).body).not.toHaveProperty("async");
    expect(() => buildAicomingHaiyaGptImage25Request({ prompt: "photo", aspectRatio: "auto" })).toThrow(/明确/);
    expect(() => buildAicomingHaiyaGptImage25Request({ prompt: "photo", quality: "ultra" })).toThrow(/画质/);
  });

  it.each(["low", "medium", "high", "xhigh", "max"])("preserves %s from shared controls and Agent validation into both Haiya modes", (quality) => {
    expect(normalizeImageQuality(AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID, quality)).toBe(quality);
    for (const mode of ["flare", "sunburst"]) {
      const parsed = createImageTaskSchema.parse({ prompt: "photo", model: AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID, quality, gptImage25Mode: mode });
      const request = buildAicomingHaiyaGptImage25Request({ prompt: parsed.prompt, mode: parsed.gptImage25Mode, quality: parsed.quality });
      expect(request.body).toMatchObject({ model: `gpt-image-2.5-${mode}`, quality });
      expect(request.body).not.toHaveProperty("async");
    }
  });

  it.each(["1K", "2K", "4K"])("keeps all fifteen %s ratios within pixel tier and dimension constraints", (resolution) => {
    const [min, max] = resolution === "1K" ? [655360, 1048576] : resolution === "2K" ? [1048577, 4194304] : [4194305, 8294400];
    for (const ratio of AICOMING_GPT_IMAGE_25_RATIOS) {
      const [w, h] = mapAicomingGptImage25Pixels(ratio, resolution).split("x").map(Number);
      expect(w % 16).toBe(0); expect(h % 16).toBe(0);
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
      expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(3);
      expect(w * h).toBeGreaterThanOrEqual(min); expect(w * h).toBeLessThanOrEqual(max);
      const [rw, rh] = ratio.split(":").map(Number);
      expect(Math.abs(w / h - rw / rh) / (rw / rh)).toBeLessThan(0.02);
    }
  });

  it("registers one local entry requiring both capabilities and preserves provider disablement", () => {
    const entries = IMAGE_EDIT_MODEL_DEFINITIONS.filter((model) => model.provider === "aicoming-haiya" && model.id.includes("2.5"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID, label: "GPT-Image-2.5（hai）", upstreamModelIds: ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] });
    const base = getBuiltinProviders().find((provider) => provider.id === "aicoming-haiya")!;
    const merged = mergeSavedProvidersWithBuiltins([{ ...base, enabled: false, imageModels: ["gpt-image-2-2k"] }]);
    expect(merged.find((p) => p.id === "aicoming-haiya")?.imageModels).toEqual(expect.arrayContaining(Object.values(AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS)));
    expect(isProviderModelEnabled(merged, "image", AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID)).toBe(false);
    expect(isProviderModelEnabled([{ ...base, enabled: true, imageModels: ["gpt-image-2.5-flare"] }], "image", AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID)).toBe(false);
  });

  it("exposes the requested five Chinese qualities on Haiya and preserves APIMart", () => {
    const params = getImageModelParams(AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID);
    expect(params.qualities.map((option) => option.label)).toEqual(["低", "标准", "高", "超高", "极致"]);
    expect(params.aspectRatios).toHaveLength(15);
    expect(params.resolutions.map((option) => option.value)).toEqual(["1K", "2K", "4K"]);
    expect(getImageModelParams("gpt-image-2.5-apimart").qualities).toHaveLength(5);
  });

  it.each(["flare", "sunburst"] as const)("bills %s by its actual upstream model and selected pixel tier", async (mode) => {
    const prices = mode === "flare" ? [0.04, 0.06, 0.09] : [0.09, 0.12, 0.15];
    for (const [index, resolution] of ["1K", "2K", "4K"].entries()) {
      const providerModel = AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS[mode];
      const db = {
        billingPriceRule: { findMany: vi.fn(async ({ where }) => AICOMING_HAIYA_GPT_IMAGE_25_PRICE_RULES.filter((rule) => where.model.in.includes(rule.model))) },
        usageLedger: { upsert: vi.fn(async ({ create }) => create) },
      };
      const ledger = await upsertUsageLedgerForGeneration({ id: 25, userId: "7", authUserId: 7, type: "image_edit", source: "tool", prompt: "photo", templateData: JSON.stringify({ model: AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID, providerModel, gptImage25Mode: mode, resolution, quality: "high", outputCount: 1 }), model: AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID, status: "success", externalProvider: "aicoming-haiya", externalTaskId: "imgtask_25", errorMsg: null, finishedAt: new Date("2026-09-09T00:01:00Z"), createdAt: new Date("2026-09-09T00:00:00Z") }, db);
      expect(ledger).toMatchObject({ providerModel, currency: "CNY", costStatus: "priced" });
      expect(ledger.amount.toNumber()).toBe(prices[index]);
      expect(ledger.unitCount.toNumber()).toBe(1);
    }
  });
});
