/** Scope-limited local upgrade. Inspect by default; --write enables the three models and records list prices. */
import assert from "node:assert/strict";
import prisma from "../lib/prisma";
import { NANO_BANANA_21_PRICE_RULES } from "../lib/billing/nano-banana-21-pricing";
import { NANO_BANANA_21_PROVIDER_MODELS } from "../lib/nano-banana-21-providers";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "../lib/toolbox-models";
import { mergeSavedProvidersWithBuiltins, SETTING_KEY_PROVIDERS } from "../lib/providers/registry";
import { getBillingCatalog } from "../lib/billing/catalog";
import { readBillingSettings, withBillingWrite } from "../lib/billing/settings";
import { BILLING_SETTING_KEY } from "../lib/billing/money";

async function main() {
  assert.equal(process.env.INKVIA_RUNTIME_PROFILE, "local");
  const target = new URL(process.env.DATABASE_URL!);
  assert(["127.0.0.1:5434/inkvia", "127.0.0.1:55432/ai_stools_mac_dev"].includes(`${target.hostname}:${target.port}${target.pathname}`));
  const definitions = IMAGE_EDIT_MODEL_DEFINITIONS.filter(m => NANO_BANANA_21_PROVIDER_MODELS.includes(m.id));
  const readState = async (db: any) => {
    const providerRow = await db.appSetting.findUnique({ where: { key: SETTING_KEY_PROVIDERS } });
    const saved = JSON.parse(providerRow?.value || "[]");
    const visibilityRow = await db.appSetting.findUnique({ where: { key: "image_edit_model_visibility" } });
    return { saved, providers: mergeSavedProvidersWithBuiltins(saved), visibility: JSON.parse(visibilityRow?.value || "{}") };
  };
  if (process.argv.includes("--write")) await withBillingWrite(async db => {
    const state = await readState(db);
    const settings = await readBillingSettings(db);
    const effectiveFrom = new Date();
    for (const definition of definitions) {
      const provider = state.providers.find(p => p.id === definition.provider)!;
      const index = state.saved.findIndex((p: any) => p.id === provider.id);
      // Preserve every unrelated provider field and capability.
      const updated = { ...(index >= 0 ? state.saved[index] : provider), enabled: true,
        imageModels: Array.from(new Set([...(index >= 0 ? state.saved[index].imageModels || [] : provider.imageModels), definition.upstreamModelId || definition.id])) };
      if (index >= 0) state.saved[index] = updated; else state.saved.push(updated);
      state.visibility[definition.id] = true;
      const rows = NANO_BANANA_21_PRICE_RULES.filter(r => r.model === definition.id);
      const existing = await db.billingPriceRule.findMany({ where: { provider: provider.id, model: definition.id, isActive: true, effectiveTo: null } });
      if (existing.length) {
        assert.equal(existing.length, rows.length, `Review existing prices for ${definition.id}`);
        assert(rows.every(r => existing.some((old: any) => old.unitType === r.unitType && String(old.unitPrice) === String(r.unitPrice) && old.currency === r.currency && JSON.stringify(old.matchConditions || {}) === JSON.stringify(r.matchConditions || {}))), `Existing prices differ: ${definition.id}`);
      } else await db.billingPriceRule.createMany({ data: rows.map(r => ({ ...r, matchConditions: r.matchConditions || {}, displayName: definition.label, priority: 100, isActive: true, effectiveFrom })) });
    }
    for (const [key, value] of [[SETTING_KEY_PROVIDERS, state.saved], ["image_edit_model_visibility", state.visibility]] as const) {
      await db.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
    }
    settings.revision++;
    await db.appSetting.upsert({ where: { key: BILLING_SETTING_KEY }, create: { key: BILLING_SETTING_KEY, value: JSON.stringify(settings) }, update: { value: JSON.stringify(settings) } });
  });
  const state = await readState(prisma);
  const settings = await readBillingSettings();
  const catalog = (await getBillingCatalog(settings)).filter(m => NANO_BANANA_21_PROVIDER_MODELS.includes(m.model));
  console.log(JSON.stringify({ written: process.argv.includes("--write"), models: definitions.map(d => {
    const p = state.providers.find(p => p.id === d.provider)!;
    return { id: d.id, label: d.label, provider: p.id, enabled: p.enabled, hasKey: Boolean(p.apiKey?.trim()), capability: p.imageModels.includes(d.upstreamModelId || d.id), visible: state.visibility[d.id] !== false,
      pricing: { complete: catalog.find(m => m.model === d.id)?.complete, rows: catalog.find(m => m.model === d.id)?.slots.map(s => ({ unit: s.unitType, conditions: s.conditions, price: s.rule?.unitPrice, currency: s.rule?.currency, missing: s.missing })) } };
  }) }, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
