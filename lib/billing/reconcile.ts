import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { llmCostSettlement, selectTokenPrices } from "./llm";
import { failedCostData, isFailedBillingStatus } from "./failed-cost";
import {
  activeAt,
  convertToCny,
  decimal,
  resolveExchangeRate,
  tokenCharges,
  type BillingSettings,
} from "./money";

export async function previewReconciliation(
  db: any,
  where: any,
  settings: BillingSettings,
  cursor = 0,
) {
  const rows = await db.usageLedger.findMany({
    where: {
      AND: [
        where,
        { id: { gt: cursor } },
        {
          OR: [
            { costStatus: "pending", finishedAt: { not: null }, unitType: "token" },
            { costStatus: "pending", unitType: { not: "token" }, generation: { is: { status: { in: ["success", "failed", "cancelled", "canceled"] } } } },
            {
              costStatus: { in: ["unpriced", "missing_rate", "missing_usage"] },
            },
            {
              costStatus: "priced",
              currency: { not: "CNY" },
              NOT: {
                pricingSnapshot: {
                  path: ["conversion", "amountCny"],
                  not: Prisma.AnyNull,
                },
              },
            },
          ],
        },
      ],
    },
    orderBy: { id: "asc" },
    take: 100,
  });
  const updates: {
    id: number;
    before: string;
    after: string;
    data: any;
    model: string;
    provider: string | null;
    providerModel: string | null;
    updatedAt: Date;
  }[] = [];
  for (const row of rows) {
    let after: any = null;
    if (isFailedBillingStatus(row.status || '')) {
      after = { ...row, ...failedCostData(row.pricingSnapshot) };
    } else if (row.costStatus === "pending" && row.unitType === "token") {
      if (row.finishedAt && row.unitType === "token" && row.pricingSnapshot?.version === 1) {
        after = { ...row, ...llmCostSettlement(row.pricingSnapshot, row.usageSnapshot) };
      }
    } else if (row.costStatus === "missing_rate" || row.costStatus === "priced") {
      const rate = resolveExchangeRate(
        settings.rates,
        row.externalProvider || "",
        row.currency,
        row.occurredAt,
      );
      const originalAmount =
        row.pricingSnapshot?.conversion?.originalAmount ?? String(row.amount);
      if (rate)
        after = {
          ...row,
          costStatus: "priced",
          pricingSnapshot: {
            ...(row.pricingSnapshot || {}),
            conversion: {
              version: 1,
              originalAmount,
              originalCurrency: row.currency,
              amountCny: convertToCny(originalAmount, rate),
              rate: rate.rate,
              rateId: rate.id,
              effectiveFrom: rate.effectiveFrom,
            },
          },
        };
    } else if (row.unitType === "token") {
      const rules = (
        await db.billingPriceRule.findMany({
          where: {
            provider: row.externalProvider || "",
            model: row.model,
            isActive: true,
          },
          orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
        })
      ).filter((r: any) => activeAt(r, row.occurredAt));
      const prices: Record<string, string> = {},
        selected: any[] = [];
      for (const r of rules)
        if (
          r.unitType.endsWith("_million_token") &&
          prices[r.unitType] === undefined
        ) {
          prices[r.unitType] = String(r.unitPrice);
          selected.push(r);
        }
      const currency = selected[0]?.currency;
      const charges =
        selected.length && selected.every((r) => r.currency === currency)
          ? tokenCharges(
              row.usageSnapshot,
              selectTokenPrices(
                rules,
                row.occurredAt,
                row.usageSnapshot?.inputTokens,
              ),
            )
          : null;
      const rate = resolveExchangeRate(
        settings.rates,
        row.externalProvider || "",
        currency || "",
        row.occurredAt,
      );
      if (charges && rate)
        after = {
          ...row,
          amount: charges.amount,
          currency,
          costStatus: "priced",
          pricingSnapshot: {
            prices,
            charges: charges.items,
            effectiveFrom: selected[0].effectiveFrom,
            conversion: {
              version: 1,
              originalAmount: charges.amount,
              originalCurrency: currency,
              amountCny: convertToCny(charges.amount, rate),
              rate: rate.rate,
              rateId: rate.id,
              effectiveFrom: rate.effectiveFrom,
            },
          },
        };
    } else {
      const generation = row.generationId
        ? await db.generation.findUnique({ where: { id: row.generationId } })
        : null;
      const archived =
        row.requestSnapshot?.params && row.requestSnapshot?.type
          ? {
              id: row.generationId || -row.id,
              userId: row.userId,
              authUserId: row.authUserId,
              type: row.requestSnapshot.type,
              source: row.source,
              model: row.model,
              status: row.status,
              externalProvider: row.externalProvider,
              externalTaskId: row.externalTaskId,
              errorMsg: null,
              prompt: "",
              templateData: JSON.stringify(row.requestSnapshot.params),
              createdAt: row.occurredAt,
              finishedAt: row.finishedAt,
            }
          : null;
      if (generation || archived)
        after = await upsertUsageLedgerForGeneration(generation || archived, {
          billingPriceRule: db.billingPriceRule,
          appSetting: db.appSetting,
          usageLedger: {
            findUnique: async () => row,
            upsert: async ({ update }: any) => ({ ...row, ...update }),
          },
        });
    }
    if (after?.costStatus === "priced" || after?.costStatus === "failed") {
      const data = {
        status: after.status,
        billable: after.billable,
        ...(row.costStatus === "pending" ? {
          status: after.status, billable: after.billable, finishedAt: after.finishedAt,
          requestSnapshot: after.requestSnapshot ?? undefined,
        } : {}),
        unitType: after.unitType,
        unitCount: after.unitCount,
        unitPrice: after.unitPrice,
        amount: after.amount,
        currency: after.currency,
        costStatus: after.costStatus,
        pricingSnapshot: JSON.parse(JSON.stringify(after.pricingSnapshot)),
        usageSnapshot: after.usageSnapshot ?? undefined,
      };
      updates.push({
        id: row.id,
        model: row.model,
        provider: row.externalProvider,
        providerModel: row.providerModel,
        updatedAt: row.updatedAt,
        before: row.pricingSnapshot?.conversion?.amountCny || "0",
        after:
          after.pricingSnapshot?.conversion?.amountCny || String(after.amount),
        data,
      });
    }
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ revision: settings.revision, updates }))
    .digest("hex");
  return {
    updates,
    digest,
    scanned: rows.length,
    nextCursor: rows.at(-1)?.id || cursor,
    hasMore: rows.length === 100,
    amountCny: updates
      .reduce((sum, u) => sum.add(u.after).sub(u.before), decimal(0))
      .toFixed(8),
  };
}
