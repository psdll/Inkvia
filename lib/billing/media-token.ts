import { APIMART_NANO_BANANA_21_MODEL } from "@/lib/nano-banana-21-providers";
import {
  activeAt,
  matches,
  decimal,
  resolveExchangeRate,
  convertToCny,
} from "./money";
import { readBillingSettings } from "./settings";
import { APIMART_QUOTES } from "./apimart-pricing";
import { TUZI_IMAGE_QUOTES, normalizeTuziImageUsage } from "./tuzi-pricing";
import { GOOGLE_IMAGE_QUOTES, googleImageTokenCounts } from "./google-pricing";
export function mediaTokenCounts(u: any) {
  if (!u || typeof u !== "object") return null;
  const details = u.input_tokens_details || u.prompt_tokens_details;
  const output = u.output_tokens_details || u.completion_tokens_details;
  const count = (v: any) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const text = count(details?.text_tokens),
    image = count(details?.image_tokens);
  const cachedText = count(
    details?.cached_tokens_details?.text_tokens ??
      details?.cached_text_tokens ??
      0,
  );
  const cachedImage = count(
    details?.cached_tokens_details?.image_tokens ??
      details?.cached_image_tokens ??
      0,
  );
  // A combined cached count cannot safely be assigned to text or image pricing.
  if (
    count(details?.cached_tokens) !== null &&
    details.cached_tokens !== cachedText! + cachedImage!
  )
    return null;
  if (
    text === null ||
    image === null ||
    cachedText === null ||
    cachedImage === null ||
    text < cachedText ||
    image < cachedImage
  )
    return null;
  return {
    text_input_million_token: text - cachedText,
    image_input_million_token: image - cachedImage,
    cached_text_input_million_token: cachedText,
    cached_image_input_million_token: cachedImage,
    text_output_million_token: count(output?.text_tokens),
    image_output_million_token: count(output?.image_tokens),
  };
}
export async function recordMediaTokenCost(
  g: any,
  params: any,
  context: any,
  rules: any[],
  db: any,
) {
  const at = g.createdAt || new Date(),
    provider = g.externalProvider;
  const required = (provider === "google-ai-studio" ? GOOGLE_IMAGE_QUOTES[g.model] : provider === "tuzi" ? TUZI_IMAGE_QUOTES[g.model] : APIMART_QUOTES[g.model]).filter((q) =>
    matches(q.conditions, context),
  );
  const active = rules.filter(
    (r) => activeAt(r, at) && matches(r.matchConditions, context),
  );
  const selected = required.map((q) =>
    active.find((r) => r.unitType === q.unitType),
  );
  const counts = provider === "google-ai-studio" ? googleImageTokenCounts(params.providerUsage?.usageMetadata) : mediaTokenCounts(
    provider === "tuzi" ? normalizeTuziImageUsage(params.providerUsage?.usage || params.providerUsage || params.usage) : params.providerUsage?.usage || params.providerUsage || params.usage,
  );
  const complete =
    required.length > 0 &&
    selected.every(Boolean) &&
    selected.every((r) => r.currency === selected[0].currency);
  const usageComplete =
    counts && required.every((q) => (counts as any)[q.unitType] != null);
  const currency = selected.find(Boolean)?.currency || "CNY";
  const charges =
    complete && usageComplete
      ? required.map((q, i) => ({
          unitType: q.unitType,
          tokens: (counts as any)[q.unitType],
          unitPrice: String(selected[i].unitPrice),
          ruleId: selected[i].id,
          amount: decimal((counts as any)[q.unitType])
            .div(1000000)
            .mul(selected[i].unitPrice)
            .toFixed(8),
        }))
      : [];
  const settings = await readBillingSettings(db);
  // Old APIMART task responses contain actual debited credits but no token breakdown.
  // Only an explicitly configured, historically applicable credit rate can value them.
  const reportedCredits = params.providerUsage?.credits_cost;
  const creditRate = provider === "apimart" && g.model !== APIMART_NANO_BANANA_21_MODEL && complete && !usageComplete
    && typeof reportedCredits === "number" && Number.isFinite(reportedCredits) && reportedCredits >= 0
    ? resolveExchangeRate(settings.rates, provider, "CREDIT", at) : null;
  const creditFallback = creditRate && decimal(creditRate.rate).gt(0)
    ? { credits: decimal(reportedCredits).toDecimalPlaces(8).toString(), rate: creditRate }
    : null;
  const amount = creditFallback
    ? decimal(creditFallback.credits).mul(creditFallback.rate.rate).toFixed(8)
    : charges
    .reduce((sum, c) => sum.add(c.amount), decimal(0))
    .toFixed(8);
  const settledCurrency = creditFallback ? "CNY" : currency;
  const rate = resolveExchangeRate(
    settings.rates,
    provider,
    settledCurrency,
    at,
  );
  const priced = complete && (usageComplete || !!creditFallback);
  const data = {
    userId: String(g.userId || ""),
    authUserId: g.authUserId ?? null,
    username: g.authUser?.username || null,
    module: "image",
    source: g.source || "tool",
    externalProvider: provider,
    externalTaskId: g.externalTaskId || null,
    model: g.model,
    providerModel: context.providerModel || g.model,
    status: g.status,
    billable: true,
    unitType: creditFallback ? "credit" : "media_token",
    unitCount: creditFallback ? creditFallback.credits : charges.reduce((s, c) => s + c.tokens, 0),
    unitPrice: creditFallback ? creditFallback.rate.rate : 0,
    amount,
    currency: settledCurrency,
    costStatus: !complete
      ? "unpriced"
      : !priced
        ? "missing_usage"
        : !rate
          ? "missing_rate"
          : "priced",
    occurredAt: at,
    finishedAt: g.finishedAt || null,
    pricingSnapshot: {
      charges,
      ...(creditFallback ? { basis: "provider_reported_credits", reportedCredits: creditFallback.credits, creditConversion: { ...creditFallback.rate } } : {}),
      effectiveFrom:
        selected.find(Boolean)?.effectiveFrom?.toISOString() || null,
      conversion: {
        originalAmount: amount,
        originalCurrency: settledCurrency,
        amountCny: priced ? convertToCny(amount, rate) : null,
        rate: rate?.rate || null,
        rateId: rate?.id || null,
      },
    },
    usageSnapshot: params.providerUsage || {},
    requestSnapshot: { type: g.type, params },
  };
  return db.usageLedger.upsert({
    where: { generationId: g.id },
    create: { ...data, generationId: g.id, requestKey: g.requestKey || null },
    update: data,
  });
}
