/** Run only against the existing isolated p0 test runtime. All fixture writes are rolled back. */
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";

async function main() {
  const env = JSON.parse(
    fs.readFileSync(".runtime-local/p0-test/environment.json", "utf8"),
  );
  if (env.INKVIA_RUNTIME_PROFILE !== "test")
    throw new Error("Test runtime required");
  const target = new URL(env.DATABASE_URL);
  if (
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    !target.pathname.endsWith("_test")
  )
    throw new Error("Isolated local test database required");
  const resource = JSON.parse(
    fs.readFileSync(".runtime-local/p0-test/resource.json", "utf8"),
  );
  const policy = JSON.parse(
    fs.readFileSync(env.INKVIA_RUNTIME_POLICY, "utf8"),
  );
  const label = execFileSync(
    "docker",
    [
      "inspect",
      "--format",
      '{{index .Config.Labels "inkvia.p0.instance"}}',
      resource.containerId,
    ],
    { encoding: "utf8" },
  ).trim();
  if (label !== resource.instanceId || label !== policy.database.instanceId)
    throw new Error("Test resource identity mismatch");
  const binding = execFileSync(
    "docker",
    ["port", resource.containerId, "5432/tcp"],
    { encoding: "utf8" },
  ).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(binding))
    throw new Error("Test binding must be loopback");
  target.port = binding.split(":")[1];
  const testPolicy = path.resolve(
    ".runtime-local/p0-test/scratch/billing-test-policy.json",
  );
  fs.writeFileSync(
    testPolicy,
    JSON.stringify({
      ...policy,
      database: { ...policy.database, endpointId: binding },
    }),
  );
  Object.assign(process.env, env, {
    DATABASE_URL: target.toString(),
    INKVIA_RUNTIME_POLICY: testPolicy,
  });
  const { prepareRuntime } = await import("./lib/runtime-isolation.cjs");
  await prepareRuntime();
  const { default: db } = await import("../lib/prisma");
  const { monthlyReport, ledgerView } = await import("../lib/billing/monthly");
  const { previewReconciliation } = await import("../lib/billing/reconcile");
  const { upsertUsageLedgerForGeneration } =
    await import("../lib/billing-ledger");
  const { getBillingCatalog } = await import("../lib/billing/catalog");
  const { beginLlmCost, finishLlmCost } = await import("../lib/billing/llm");
  const { BILLING_SETTING_KEY } = await import("../lib/billing/money");
  const rollback = new Error("BILLING_TEST_ROLLBACK");
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(22092026)::text`;
        const userId = `billing-test-${Date.now()}`;
        const provider = userId;
        const at = new Date("2098-04-01T00:00:00+08:00");
        const base = {
          userId,
          module: "image",
          source: "test",
          externalProvider: provider,
          model: "test-image",
          status: "success",
          billable: true,
          unitType: "image",
          unitCount: 1,
          unitPrice: 1,
          amount: 1,
          currency: "CNY",
          costStatus: "priced",
          occurredAt: at,
        };
        for (let i = 0; i < 11; i++)
          await tx.usageLedger.createMany({
            data: Array.from({ length: i === 10 ? 1 : 1000 }, () => base),
          });
        const foreign = await tx.usageLedger.create({
          data: {
            ...base,
            amount: 2,
            currency: "USD",
            pricingSnapshot: {
              conversion: {
                originalAmount: "2",
                amountCny: "14.40000000",
                rate: "7.2",
                rateId: "fx1",
              },
            },
          },
        });
        const unknown = await tx.usageLedger.create({
          data: {
            ...base,
            amount: 2,
            currency: "USD",
            pricingSnapshot: { ruleId: 1 },
          },
        });
        await tx.usageLedger.create({
          data: {
            ...base,
            amount: 999,
            occurredAt: new Date("2098-04-30T16:00:00Z"),
          },
        });
        const scope = { month: "2098-04", provider };
        const report = await monthlyReport(scope, tx);
        assert.equal(report.summary.ledgerCount, 10003);
        assert.equal(report.summary.totalAmount, "10015.40000000");
        assert.equal(report.summary.pendingCount, 1);
        assert.equal(report.summary.missingRateCount, 1);
        assert.equal(ledgerView(foreign).amountCny, "14.40000000");
        const settings = {
          mode: "observe" as const,
          revision: 1,
          rates: [
            {
              id: "fx-test",
              provider,
              currency: "USD",
              rate: "7.2",
              effectiveFrom: "2020-01-01T00:00:00Z",
              notes: "synthetic",
            },
          ],
        };
        const preview = await previewReconciliation(
          tx,
          {
            userId,
            occurredAt: { gte: at, lt: new Date("2098-04-30T16:00:00Z") },
          },
          settings,
        );
        assert.deepEqual(
          preview.updates.map((u) => u.id),
          [unknown.id],
        );
        assert.equal(preview.amountCny, "14.40000000");
        assert.equal(
          (await tx.usageLedger.findUnique({ where: { id: unknown.id } }))!
            .pricingSnapshot && ledgerView(unknown).amountCny,
          null,
        );
        await tx.usageLedger.update({
          where: { id: unknown.id },
          data: preview.updates[0].data,
        });
        assert.equal(
          (await monthlyReport(scope, tx)).summary.totalAmount,
          "10029.80000000",
        );
        const units = [
          "input_million_token",
          "output_million_token",
          "cached_million_token",
          "cache_creation_million_token",
        ];
        await tx.appSetting.upsert({
          where: { key: BILLING_SETTING_KEY },
          create: { key: BILLING_SETTING_KEY, value: JSON.stringify(settings) },
          update: { value: JSON.stringify(settings) },
        });
        await tx.billingPriceRule.createMany({
          data: units.map((unitType, i) => ({
            provider,
            model: "test-chat",
            module: "agent",
            unitType,
            unitPrice: i === 1 ? 8 : 2,
            currency: "USD",
            effectiveFrom: new Date("2020-01-01"),
          })),
        });
        const call = await beginLlmCost(
          { provider, model: "test-chat", source: "test", userId },
          tx,
        );
        await finishLlmCost(
          call,
          { inputTokens: 1000000, outputTokens: 200000 },
          true,
          tx,
        );
        await finishLlmCost(
          call,
          { inputTokens: 9999999, outputTokens: 999999 },
          true,
          tx,
        );
        const stored = await tx.usageLedger.findUniqueOrThrow({
          where: { id: call.id },
        });
        assert.equal(ledgerView(stored).amountCny, "25.92000000");
        const generation = await tx.generation.create({
          data: {
            userId,
            type: "image_edit",
            source: "test",
            prompt: "synthetic billing regression",
            model: "test-image",
            status: "success",
            externalProvider: provider,
            createdAt: at,
            templateData: "{}",
          },
          select: {
            id: true,
            userId: true,
            authUserId: true,
            type: true,
            source: true,
            prompt: true,
            model: true,
            status: true,
            externalProvider: true,
            externalTaskId: true,
            errorMsg: true,
            templateData: true,
            createdAt: true,
            finishedAt: true,
          },
        });
        await tx.billingPriceRule.create({
          data: {
            provider,
            model: "test-image",
            module: "image",
            unitType: "image",
            unitPrice: 0.2,
            effectiveFrom: new Date("2020-01-01"),
          },
        });
        const first = await upsertUsageLedgerForGeneration(generation, tx);
        await tx.billingPriceRule.create({
          data: {
            provider,
            model: "test-image",
            module: "image",
            unitType: "image",
            unitPrice: 9,
            effectiveFrom: new Date("2020-01-01"),
            priority: 500,
          },
        });
        const repeated = await upsertUsageLedgerForGeneration(generation, tx);
        assert.equal(String(repeated.amount), String(first.amount));
        await tx.generation.delete({
          where: { id: generation.id },
          select: { id: true },
        });
        assert.equal(
          (await tx.usageLedger.findUniqueOrThrow({ where: { id: first.id } }))
            .generationId,
          null,
        );
        const catalog = await getBillingCatalog(settings, new Date(), tx);
        assert(catalog.length > 0);
        console.log(
          JSON.stringify({
            passed: true,
            checks: [
              "10003 rows fully aggregated",
              "Shanghai month boundary",
              "mixed currency separated",
              "historical FX preview then fill",
              "token CNY 25.92",
              "duplicate settlement unchanged",
              "generation deletion retains ledger",
              "catalog loads",
            ],
            fixtureWrites: "ROLLBACK",
          }),
        );
        throw rollback;
      },
      { timeout: 60000 },
    );
  } catch (e) {
    if (e !== rollback) throw e;
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Billing verification failed",
  );
  process.exitCode = 1;
});
