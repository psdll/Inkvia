/** Read-only local verification. Does not write prices or settings.
 * Optional argument: fixture output path for billing-migration-roundtrip.test.ts.
 * Set BILLING_MIGRATION_FIXTURE to that path when running the isolated tests.
 */
import assert from "node:assert/strict";
import prisma from "../lib/prisma";
import { readBillingSettings, withBillingWrite } from "../lib/billing/settings";
import { getBillingCatalog, UNIT_LABELS } from "../lib/billing/catalog";
import { exportCurrentPrices, planPriceImport } from "../lib/billing/migration";
import { batchDrafts, batchRateDrafts } from "../lib/billing/batch-drafts";

async function main() {
  assert.equal(process.env.INKVIA_RUNTIME_PROFILE, "local");
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(`${target.hostname}:${target.port}${target.pathname}`, "127.0.0.1:5434/inkvia");
  await withBillingWrite(async db => {
    const settings = await readBillingSettings(db);
    const catalog = await getBillingCatalog(settings, new Date(), db);
    const file = JSON.parse(JSON.stringify(exportCurrentPrices(settings, catalog)));
    const empty = { mode: "observe" as const, revision: 0, rates: [] };
    const plan = planPriceImport(file, empty, catalog, UNIT_LABELS);
    const batch = batchDrafts(plan.drafts, "", catalog);
    const rates = batchRateDrafts(plan.rateDrafts, "", catalog);
    assert.equal(plan.report.items.filter(i => i.status === "failed" || i.status === "skipped").length, 0);
    assert.deepEqual(batch.conflicts, []);
    assert.deepEqual(rates.conflicts, []);
    const repeated = planPriceImport(file, { ...empty, drafts: plan.drafts, rateDrafts: plan.rateDrafts }, catalog, UNIT_LABELS);
    assert(repeated.report.items.every(i => i.status === "existing"));
    const fixturePath = process.argv[2];
    if (fixturePath) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(fixturePath, JSON.stringify({ file, catalog }, null, 2));
    }
    console.log(JSON.stringify({ models: catalog.filter(m => !m.historical).length, bytes: Buffer.byteLength(JSON.stringify(file)), publishable: batch.ready.length, priceRows: batch.rowCount, rates: rates.ready.length, missingSlots: file.missing.length, missingModels: [...new Set(file.missing.map((m: { provider: string; model: string }) => `${m.provider}/${m.model}`))], conflicts: batch.conflicts, rateConflicts: rates.conflicts, repeatImport: "all existing" }, null, 2));
  });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
