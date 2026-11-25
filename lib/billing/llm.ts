import { isBigModelGlm53 } from "@/lib/bigmodel-llm-models";
import { isDoubaoSeedEvolving } from "@/lib/volcengine-llm-models";
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { readBillingSettings } from "./settings";
import {
  activeAt,
  matches,
  convertToCny,
  resolveExchangeRate,
  tokenCharges,
  type TokenUsage,
} from "./money";
import { APIMART_QUOTES, apimartContext } from "./apimart-pricing";
import { MINIMAX_LLM_QUOTES } from "./minimax-pricing";
import { DEEPSEEK_QUOTES, deepseekTimeBand } from "./deepseek-pricing";
import { EASYROUTER_QUOTES } from "./easyrouter-pricing";
import { persistUsageWrite } from "./usage-persistence";
import { failedCostData } from "./failed-cost";
export function selectTokenPrices(
  rules: any[],
  at: Date | string,
  inputTokens: number | null | undefined,
) {
  const context = {
    ...apimartContext(at, inputTokens),
    deepseekTimeBand: deepseekTimeBand(at),
    minimaxInputBand: inputTokens == null ? undefined : inputTokens > 512000 ? "over_512000" : "up_to_512000",
  };
  const prices: Record<string, string> = {};
  for (const r of rules)
    if (
      r.unitType.endsWith("_million_token") &&
      matches(r.matchConditions, context) &&
      prices[r.unitType] === undefined
    )
      prices[r.unitType] = String(r.unitPrice);
  return prices;
}

export async function beginLlmCost(
  input: {
    provider: string;
    model: string;
    source: string;
    userId?: string;
    authUserId?: number;
    requestKey?: string;
  },
  db: any = prisma,
) {
  const at = new Date();
  const settings = await readBillingSettings(db);
  const rules = (
    await db.billingPriceRule.findMany({
      where: { provider: input.provider, model: input.model, isActive: true },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    })
  ).filter((r: any) => activeAt(r, at));
  const prices: Record<string, string> = {};
  const selected: any[] = [];
  for (const r of rules)
    if (
      r.unitType.endsWith("_million_token") &&
      prices[r.unitType] === undefined
    ) {
      prices[r.unitType] = String(r.unitPrice);
      selected.push(r);
    }
  const currency = selected[0]?.currency || "CNY";
  const consistent = selected.every((r) => r.currency === currency);
  const rate = resolveExchangeRate(
    settings.rates,
    input.provider,
    currency,
    at,
  );
  const complete =
    (input.provider === "apimart" && APIMART_QUOTES[input.model]
      ? APIMART_QUOTES[input.model].every((q) =>
          rules.some(
            (r: any) =>
              r.unitType === q.unitType &&
              matches(r.matchConditions, q.conditions),
          ),
        )
      : input.provider === "easyrouter" && EASYROUTER_QUOTES[input.model]
        ? EASYROUTER_QUOTES[input.model].every((q) => rules.some((r: any) => r.unitType === q.unitType && matches(r.matchConditions, q.conditions)))
      : input.provider === "deepseek" && DEEPSEEK_QUOTES[input.model]
        ? DEEPSEEK_QUOTES[input.model].every((q) => rules.some((r: any) => r.unitType === q.unitType && matches(r.matchConditions, q.conditions))) && deepseekTimeBand(at) !== undefined
      : input.provider === "minimax" && MINIMAX_LLM_QUOTES[input.model]
        ? MINIMAX_LLM_QUOTES[input.model].every((q) => rules.some((r: any) => r.unitType === q.unitType && matches(r.matchConditions, q.conditions)))
      : [
          "input_million_token",
          "output_million_token",
          "cached_million_token",
          "cache_creation_million_token",
        ].filter((unit) => !(((input.provider === "bailian" && input.model === "qwen3.8-omni-flash") || isDoubaoSeedEvolving(input.provider, input.model) || isBigModelGlm53(input.provider, input.model)) && unit === "cache_creation_million_token"))
          .every((unit) => prices[unit] !== undefined)) && consistent;
  if (settings.mode === "strict" && (!complete || !rate))
    throw new Error(
      `模型 ${input.model} 尚未配齐 token 价格或汇率，请联系管理员`,
    );
  const snapshot = {
    version: 1,
    occurredAt: at.toISOString(),
    quotedRules: rules.map((r: any) => ({
      unitType: r.unitType,
      unitPrice: String(r.unitPrice),
      matchConditions: r.matchConditions,
      id: r.id,
    })),
    prices: consistent ? prices : {},
    rules: selected.map((r) => ({
      id: r.id,
      unitType: r.unitType,
      unitPrice: String(r.unitPrice),
      effectiveFrom: r.effectiveFrom,
    })),
    currency,
    rate,
    effectiveFrom: selected[0]?.effectiveFrom?.toISOString() || null,
  };
  const row = await db.usageLedger.create({
    data: {
      requestKey: input.requestKey ?? randomUUID(),
      userId:
        input.userId ||
        (input.authUserId ? String(input.authUserId) : "system"),
      authUserId: input.authUserId || null,
      module: "agent",
      source: input.source,
      externalProvider: input.provider,
      model: input.model,
      status: "running",
      billable: true,
      unitType: "token",
      unitCount: 0,
      unitPrice: 0,
      amount: 0,
      currency,
      costStatus: "pending",
      occurredAt: at,
      pricingSnapshot: JSON.parse(JSON.stringify(snapshot)),
    },
  });
  return { id: row.id, snapshot };
}
export function llmCostSettlement(
  snapshot: Awaited<ReturnType<typeof beginLlmCost>>['snapshot'],
  usage: TokenUsage | null | undefined,
) {
  const appliedPrices = snapshot.quotedRules
    ? selectTokenPrices(
        snapshot.quotedRules,
        snapshot.occurredAt,
        usage?.inputTokens,
      )
    : snapshot.prices;
  const charges = tokenCharges(usage, appliedPrices);
  const unpriced = !Object.keys(snapshot.prices).length;
  const costStatus = unpriced
    ? "unpriced"
    : !charges
      ? "missing_usage"
      : !snapshot.rate
        ? "missing_rate"
        : "priced";
  const originalAmount = charges?.amount || "0";
  const conversion = {
    version: 1,
    originalAmount,
    originalCurrency: snapshot.currency,
    amountCny: charges ? convertToCny(originalAmount, snapshot.rate) : null,
    rate: snapshot.rate?.rate || null,
    rateId: snapshot.rate?.id || null,
    effectiveFrom: snapshot.rate?.effectiveFrom || null,
  };
  return {
      unitCount: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
      amount: originalAmount,
      costStatus,
      usageSnapshot: usage ? JSON.parse(JSON.stringify(usage)) : {},
      pricingSnapshot: JSON.parse(
        JSON.stringify({
          ...snapshot,
          prices: appliedPrices,
          conversion,
          charges: charges?.items || [],
        }),
      ),
  };
}

export async function finishLlmCost(
  call: Awaited<ReturnType<typeof beginLlmCost>>,
  usage: TokenUsage | null | undefined,
  success: boolean,
  db: any = prisma,
) {
  // Persist evidence separately from price calculation. If calculation or its write
  // fails, a finished pending row can be reconciled with its original quoted prices.
  const usageSnapshot = usage ? JSON.parse(JSON.stringify(usage)) : {};
  const captured = await persistUsageWrite<{ count: number }>(() => db.usageLedger.updateMany({
    where: { id: call.id, costStatus: 'pending', finishedAt: null },
    data: { status: success ? 'success' : 'failed', finishedAt: new Date(), usageSnapshot,
      ...(!success ? failedCostData(call.snapshot) : {}),
    },
  }), { ledgerId: call.id });
  if (captured.count === 0 || !success) return;
  if (usage?.inputTokens == null || usage?.outputTokens == null) {
    console.warn('[billing] provider returned incomplete usage', { ledgerId: call.id });
  }
  const data = llmCostSettlement(call.snapshot, usage);
  await persistUsageWrite(() => db.usageLedger.updateMany({
    where: { id: call.id, costStatus: 'pending' }, data,
  }), { ledgerId: call.id });
}
