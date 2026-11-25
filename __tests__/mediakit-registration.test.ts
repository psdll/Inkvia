import { expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: async () => null } } }));
import { getBuiltinProviders } from "@/lib/providers/registry";
import { getProviderModelCapability, filterEnabledAdapterModels, isBuiltinProviderModel } from "@/lib/providers/model-availability";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { getBillingCatalog } from "@/lib/billing/catalog";
import { MEDIAKIT_PROVIDER, MEDIAKIT_SUBTITLE_MODEL } from "@/lib/volcengine-mediakit-models";
it("registers a separately configured canvas-only tool without a fabricated models endpoint", async () => {
  const provider = getBuiltinProviders().find(p => p.id === MEDIAKIT_PROVIDER)!;
  expect(provider).toMatchObject({ enabled: false, envKeyName: "", videoModels: [MEDIAKIT_SUBTITLE_MODEL] });
  expect(supportsProviderModelFetch(provider)).toBe(false);
  expect(isBuiltinProviderModel(provider.id, "video", MEDIAKIT_SUBTITLE_MODEL)).toBe(true);
  expect(getProviderModelCapability(provider.id, "video", MEDIAKIT_SUBTITLE_MODEL)).toEqual({ adapterBacked: true, usages: ["画布去字幕"] });
  expect(filterEnabledAdapterModels([{ ...provider, enabled: true }], "video").some(m => m.id === MEDIAKIT_SUBTITLE_MODEL)).toBe(false);
  const catalog = await getBillingCatalog({ mode: "observe", rates: [], revision: 1 } as any, new Date(), { appSetting: { findUnique: async () => null }, billingPriceRule: { findMany: async () => [] } });
  expect(catalog.find(m => m.provider === MEDIAKIT_PROVIDER)).toMatchObject({ model: MEDIAKIT_SUBTITLE_MODEL, enabled: false, complete: false, slots: [expect.objectContaining({ unitType: "minute" })] });
});
