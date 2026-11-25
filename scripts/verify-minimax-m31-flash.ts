/** Local-only integration verification. --write installs missing prices; --live makes one paid call. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import prisma from "../lib/prisma";
import { MINIMAX_M31_FLASH_MODEL_ID as modelId } from "../lib/minimax-llm-models";
import { getRegisteredProviders } from "../lib/providers/registry";
import { getLlmModelVisibility, isLlmModelVisible } from "../lib/llm-routing/visibility";
import { getBillingCatalog } from "../lib/billing/catalog";
import { DEFAULT_PRICE_RULES } from "../lib/billing/default-prices";
import { readBillingSettings, withBillingWrite } from "../lib/billing/settings";
import { BILLING_SETTING_KEY } from "../lib/billing/money";
import { canvasLlmChat } from "../lib/canvas/llm";

async function main() {
  assert.equal(process.env.INKVIA_RUNTIME_PROFILE, "local");
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(`${target.hostname}:${target.port}${target.pathname}`, "127.0.0.1:5434/inkvia");
  const provider = (await getRegisteredProviders()).find(p => p.id === "minimax")!;
  const visible = isLlmModelVisible(await getLlmModelVisibility(), "minimax", modelId);
  assert(provider?.enabled && provider.apiKey && provider.chatModels.includes(modelId) && visible, "Provider/key/capability/visibility gate failed");
  console.log(JSON.stringify({ provider: provider.id, enabled: provider.enabled, hasKey: Boolean(provider.apiKey),
    baseHost: new URL(provider.baseUrl).host, egress: provider.egressMode, models: provider.chatModels, visible }));
  const at = new Date();
  if (process.argv.includes("--write")) {
    await withBillingWrite(async db => {
      const existing = await db.billingPriceRule.findMany({ where: { provider: "minimax", model: modelId } });
      if (existing.length) return; // Never overwrite administrator prices on a rerun.
      const settings = await db.appSetting.findUnique({ where: { key: BILLING_SETTING_KEY } });
      const output = path.resolve(".exports/billing", `minimax-m31-flash-${Date.now()}`);
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, "before.json"), JSON.stringify({ rules: existing, settings }, null, 2));
      const data = DEFAULT_PRICE_RULES.filter(r => r.provider === "minimax" && r.model === modelId).map(r => ({
        ...r, displayName: modelId, effectiveFrom: at, isActive: true,
      }));
      assert.equal(data.length, 3);
      await db.billingPriceRule.createMany({ data });
      if (settings) {
        const value = JSON.parse(settings.value);
        value.revision = (value.revision || 0) + 1;
        await db.appSetting.update({ where: { key: BILLING_SETTING_KEY }, data: { value: JSON.stringify(value) } });
      }
      fs.writeFileSync(path.join(output, "installed.json"), JSON.stringify(data, null, 2));
      console.log(JSON.stringify({ installed: data.length, effectiveFrom: at, backup: output }));
    });
  }
  const catalog = await getBillingCatalog(await readBillingSettings(), new Date(), prisma, { provider: "minimax", model: modelId });
  console.log(JSON.stringify({ complete: catalog[0]?.complete, slots: catalog[0]?.slots.map(s => ({ unit: s.unitType, price: s.rule?.unitPrice, currency: s.rule?.currency })) }));
  if (process.argv.includes("--live")) {
    assert(catalog[0]?.complete, "Install prices before the paid test");
    // Uses the canvas helper and the shared route/content/billing gateway; use a local account
    // only for attribution, without reading personal fields or changing defaults.
    const user = await prisma.user.findFirst({ select: { id: true }, orderBy: { id: "asc" } });
    assert(user, "A local user is required for canvas billing attribution");
    const text = await canvasLlmChat({ authUserId: user.id, providerId: "minimax", model: modelId,
      system: '只返回一个完整 JSON 对象，不要解释，不要代码块。', prompt: '返回 {"ok":true}。' });
    assert.deepEqual(JSON.parse(text), { ok: true });
    const ledger = await prisma.usageLedger.findFirst({ where: { externalProvider: "minimax", model: modelId, occurredAt: { gte: at } }, orderBy: { id: "desc" },
      select: { id: true, status: true, costStatus: true, amount: true, currency: true, usageSnapshot: true } });
    assert.equal(ledger?.costStatus, "priced");
    console.log(JSON.stringify({ live: "passed", response: text, ledger }));
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
