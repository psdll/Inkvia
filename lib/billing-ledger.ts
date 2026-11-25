import { VOLC_SEEDREAM_55_MODEL } from "@/lib/volcengine-seedream-55";
import { APIMART_SEEDREAM_55_MODEL, seedream55PixelTier } from "@/lib/apimart-seedream-55";
import { MEDIAKIT_SUBTITLE_MODEL } from "@/lib/volcengine-mediakit-models";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { readBillingSettings } from "@/lib/billing/settings";
import { convertToCny, resolveExchangeRate, decimal } from "@/lib/billing/money";
import { isSeedAudioModel } from "@/lib/seed-audio-models";
import { recordMediaTokenCost } from "@/lib/billing/media-token";
import { persistUsageWrite } from "@/lib/billing/usage-persistence";
import { isFailedBillingStatus } from "@/lib/billing/failed-cost";
import { GOOGLE_IMAGE_QUOTES } from "@/lib/billing/google-pricing";
import { TUZI_IMAGE_QUOTES } from "@/lib/billing/tuzi-pricing";
import { APIMART_QUOTES } from "@/lib/billing/apimart-pricing";
import { APIMART_SEEDANCE_25_MODEL_ID } from "@/lib/sora2";
import {
  MINIMAX_H3_MAX_MODEL_ID,
  MINIMAX_H3_MODEL_ID,
  MINIMAX_PROVIDER_ID,
} from "@/lib/minimax-models";
import {
  MINIMAX_H3_EXCESS_IMAGE_PRICE,
  MINIMAX_H3_FREE_IMAGE_COUNT,
} from "@/lib/minimax-pricing";

type GenerationLike = {
  id: number;
  userId: string;
  authUserId: number | null;
  requestKey?: string | null;
  type: string;
  source: string;
  prompt: string;
  model: string | null;
  status: string;
  externalProvider: string | null;
  externalTaskId: string | null;
  errorMsg: string | null;
  templateData: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

function isUsageLedgerRequestKeyConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    meta?: { modelName?: unknown; target?: unknown };
  };
  if (candidate.code !== "P2002") return false;
  const modelName = String(candidate.meta?.modelName || "");
  const targets = Array.isArray(candidate.meta?.target)
    ? candidate.meta!.target.map((value) => String(value))
    : [String(candidate.meta?.target || "")];
  return (modelName === "" || modelName === "UsageLedger")
    && targets.some((target) => /(?:^|_)requestKey(?:_|$)|UsageLedger_requestKey_key/i.test(target));
}

function parseJsonObject(raw: string | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asDecimal(value: number | string) {
  return new Prisma.Decimal(String(Number.isFinite(Number(value)) ? Number(value) : 0));
}

function decimalNumber(value: unknown) {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundedAmount(value: number) {
  return Number(value.toFixed(8));
}

function normalizeModel(model: string | null | undefined, params: Record<string, any> | null) {
  return String(model || params?.model || "unknown").trim() || "unknown";
}

function inferModule(type: string) {
  const t = String(type || "").toLowerCase();
  if (t === "import") return "material";
  if (t.includes("audio")) return "audio";
  if (t.includes("video")) return "video";
  if (t.includes("face")) return "face";
  if (t.includes("image")) return "image";
  return "other";
}

function inferUnit(input: { type: string; status: string; params: Record<string, any> | null }) {
  const type = String(input.type || "").toLowerCase();
  const status = String(input.status || "").toLowerCase();
  const params = input.params || {};
  const billing = params.billing && typeof params.billing === "object" ? params.billing : {};
  if (params.videoFrame && typeof params.videoFrame === "object") return { unitType: "request", unitCount: 0, billable: false, costStatus: "non_billable" };
  if (type === "import") return { unitType: "storage_item", unitCount: 0, billable: false, costStatus: "non_billable" };
  if (billing.billable === false) {
    return { unitType: String(billing.unitType || "request"), unitCount: 0, billable: false, costStatus: "non_billable" };
  }
  if (status !== "success") return { unitType: billing.unitType === "request" ? "request" : type.includes("video") || isSeedAudioModel(params.model) ? "second" : type.includes("audio") ? "ten_thousand_character" : "image", unitCount: 0, billable: false, costStatus: isFailedBillingStatus(status) ? "failed" : "pending" };
  if (billing.unitType === "request") return { unitType: "request", unitCount: 1, billable: true, costStatus: "unpriced" };
  if (type.includes("audio")) {
    const usage = params.providerUsage || params.usage || {};
    if (isSeedAudioModel(params.model)) {
      const seconds = Number(usage.original_duration);
      return { unitType: "second", unitCount: Number.isFinite(seconds) && seconds > 0 ? seconds : 0, billable: true, costStatus: "unpriced" };
    }
    const characters = Number(usage.usage_characters || params.usageCharacters || 0);
    return {
      unitType: "ten_thousand_character",
      unitCount: Number.isFinite(characters) && characters > 0 ? characters / 10_000 : 0,
      billable: true,
      costStatus: "unpriced",
    };
  }
  if (type.includes("video")) {
    if (params.model === "wan3.0-video") {
      const usage = params.providerUsage || {};
      const output = Number(usage.output_video_duration ?? usage.duration ?? params.duration);
      const input = Number(usage.input_video_duration ?? 0);
      const seconds = Number.isFinite(output) && output > 0 && Number.isFinite(input) && input >= 0 ? output + input : 0;
      return { unitType: "second", unitCount: seconds, billable: true, costStatus: "unpriced" };
    }
    const duration = Number(params.duration);
    return { unitType: "second", unitCount: Number.isFinite(duration) && duration > 0 ? duration : 0, billable: true, costStatus: "unpriced" };
  }
  return { unitType: "image", unitCount: 1, billable: true, costStatus: "unpriced" };
}

function normalizeCompare(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim().toLowerCase();
}

function firstFilled(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function buildPricingContext(input: {
  type: string;
  params: Record<string, any> | null;
  unit: { unitType: string; unitCount: number; billable: boolean; costStatus: string };
}) {
  const params = input.params || {};
  const mediaItems = Array.isArray(params.inputMedia) ? params.inputMedia : [];
  const referenceAssets = Array.isArray(params.referenceAssets) ? params.referenceAssets : [];
  const referenceImageCount = referenceAssets.filter(
    (item: any) => String(item?.kind || item?.type || "").toLowerCase() === "image",
  ).length;
  const imagePaths = Array.isArray(params.imagePaths) ? params.imagePaths : [];
  const hasVideoInput =
    referenceAssets.some((item: any) => String(item?.kind || item?.type || "").toLowerCase() === "video") ||
    mediaItems.some((item: any) => String(item?.type || "").toLowerCase() === "video") ||
    imagePaths.some((item: any) => /\.(mp4|mov|webm|avi|mkv|m4v)(\?|#|$)/i.test(String(item || "")));
  const hasReferenceMedia =
    [...mediaItems, ...referenceAssets].some((item: any) => {
      const kind = String(item?.kind || item?.type || "").toLowerCase();
      return kind === "image" || kind === "video";
    }) ||
    imagePaths.some((item: any) => /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|mp4|mov|webm|avi|mkv|m4v)(\?|#|$)/i.test(String(item || "")));
  const outputCount = Number(params.outputCount || params.seedream?.outputCount || params.jiekou?.outputCount || 1);
  return {
    type: input.type,
    providerModel: firstFilled(params.providerModel, params.model),
    gptImage25Mode: firstFilled(params.gptImage25Mode),
    maxMode: normalizeCompare(params.maxMode ?? false),
    speed: firstFilled(params.speed, params.midjourneyV8?.speed),
    midjourneyAction: firstFilled(params.midjourneyV8?.action, hasReferenceMedia ? "edits" : "imagine"),
    taskType: firstFilled(params.taskType, input.type),
    seedream55PixelTier: params.seedream55PixelTier || seedream55PixelTier(params.customSize || "") || (["1K", "1.5K"].includes(params.resolution) ? "low" : "high"),
    resolution: firstFilled(params.resolution, params.size, params.jiekou?.size),
    aspectRatio: firstFilled(params.aspectRatio, params.aspect_ratio, params.ratio),
    ratio: firstFilled(params.ratio, params.aspectRatio, params.aspect_ratio),
    duration: firstFilled(params.duration),
    inputMode: firstFilled(params.inputMode),
    outputMode: firstFilled(params.seedream?.outputMode, params.outputMode),
    outputFormat: firstFilled(params.jiekou?.outputFormat, params.outputFormat),
    quality: firstFilled(params.jiekou?.quality, params.quality),
    generateAudio: normalizeCompare(params.generateAudio),
    webSearch: normalizeCompare(params.webSearch || params.seedream?.webSearch),
    inputContainsVideo: hasVideoInput ? "true" : "false",
    inputContainsReferenceMedia: hasReferenceMedia ? "true" : "false",
    referenceImageCount: String(referenceImageCount),
    hasInput: imagePaths.length || mediaItems.length ? "true" : "false",
    unitType: input.unit.unitType,
    outputCount: Number.isFinite(outputCount) ? String(outputCount) : "1",
  };
}

function conditionMatches(rule: { matchConditions?: unknown }, context: Record<string, unknown>) {
  const conditions = rule.matchConditions;
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return true;
  for (const [key, expectedRaw] of Object.entries(conditions as Record<string, unknown>)) {
    if (!key) continue;
    const actual = normalizeCompare(context[key]);
    if (Array.isArray(expectedRaw)) {
      const allowed = expectedRaw.map(normalizeCompare).filter(Boolean);
      if (allowed.length && !allowed.includes(actual)) return false;
      continue;
    }
    const expected = normalizeCompare(expectedRaw);
    if (expected && actual !== expected) return false;
  }
  return true;
}

function conditionSpecificity(rule: { matchConditions?: unknown }) {
  const conditions = rule.matchConditions;
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return 0;
  return Object.keys(conditions).length;
}

function unitCountForRule(unitType: string, params: Record<string, any> | null, fallback: number) {
  const p = params || {};
  const unit = String(unitType || "").trim();
  if (unit === "provider_usd") {
    const cost = p.providerUsage?.usage?.cost;
    return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : 0;
  }
  if (unit === "image") {
    const n = Number(p.outputCount || p.seedream?.outputCount || p.jiekou?.outputCount || p.openrouter?.outputCount || fallback || 1);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  if (unit === "video" || unit === "request") return 1;
  if (unit === "minute" && (isSeedAudioModel(p.model) || p.model === MEDIAKIT_SUBTITLE_MODEL)) return fallback / 60;
  if (unit === "second") {
    if (isSeedAudioModel(p.model)) return fallback;
    if (p.model === "wan3.0-video") return fallback;
    const n = Number(p.duration || fallback || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (unit === "million_token") {
    if (p.model === APIMART_SEEDANCE_25_MODEL_ID) {
      const tokens = Number(p.providerUsage?.usage?.completion_tokens ?? p.usage?.completion_tokens);
      return Number.isFinite(tokens) && tokens > 0 ? tokens / 1_000_000 : 0;
    }
    const usage = p.usage || p.providerUsage || {};
    const tokens = Number(usage.completion_tokens || usage.total_tokens || p.completion_tokens || p.total_tokens || 0);
    return Number.isFinite(tokens) && tokens > 0 ? tokens / 1_000_000 : 0;
  }
  if (unit === "ten_thousand_character") {
    const usage = p.providerUsage || p.usage || {};
    const characters = Number(usage.usage_characters || p.usageCharacters || 0);
    return Number.isFinite(characters) && characters > 0 ? characters / 10_000 : 0;
  }
  return fallback;
}

async function findActivePriceRule(input: {
  provider: string | null;
  model: string;
  providerModel: string | null;
  module: string;
  occurredAt: Date;
  context: Record<string, unknown>;
}, db: any = prisma) {
  const provider = String(input.provider || "").trim();
  const candidates = Array.from(new Set([input.model, input.providerModel].map((x) => String(x || "").trim()).filter(Boolean)));
  if (!candidates.length) return null;
  const providerFilter = provider
    ? [{ provider }, { provider: "" }]
    : [{ provider: "" }];
  const rules = await db.billingPriceRule.findMany({
    where: {
      isActive: true,
      model: { in: candidates },
      AND: [
        {
          OR: providerFilter,
        },
        {
          OR: [
            { module: input.module },
            { module: null },
            { module: "" },
          ],
        },
        {
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: input.occurredAt } },
          ],
        },
      ],
      effectiveFrom: { lte: input.occurredAt },
    } as any,
    orderBy: [{ priority: "desc" }, { effectiveFrom: "desc" }, { id: "desc" }],
  });
  return rules
    // Split token tariffs require modality usage and the dedicated token calculator.
    // Never treat a per-million-token price as the fallback image/request count.
    .filter((rule: any) => !String(rule.unitType).endsWith("_million_token"))
    .filter((rule: any) => !["input_second", "excess_image", "additional_input_image", "input_image"].includes(rule.unitType))
    .filter((rule: any) => conditionMatches(rule as any, input.context))
    .sort((a: any, b: any) => {
      const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
      if (priorityDiff) return priorityDiff;
      const specificityDiff = conditionSpecificity(b as any) - conditionSpecificity(a as any);
      if (specificityDiff) return specificityDiff;
      return +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom) || b.id - a.id;
    })[0] || null;
}

export async function upsertUsageLedgerForGenerationId(generationId: number) {
  if (!Number.isFinite(generationId) || generationId <= 0) return null;
  return persistUsageWrite(async () => {
    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
      include: { authUser: { select: { username: true } } },
    });
    if (!generation) return null;
    return upsertUsageLedgerForGeneration(generation as any);
  }, { generationId });
}

export async function upsertUsageLedgerForGeneration(
  generation: GenerationLike & { authUser?: { username: string } | null },
  db: any = prisma,
) {
  if (db === prisma && typeof db.$transaction === "function") {
    return db.$transaction(async (tx: any) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(2209, ${generation.id}::integer)::text`);
      return upsertUsageLedgerForGeneration(generation, tx);
    });
  }
  const existing = await db.usageLedger.findUnique?.({ where: { generationId: generation.id } });
  if (existing && ["priced", "free", "non_billable"].includes(existing.costStatus) && !isFailedBillingStatus(generation.status)) return existing;
  const params = parseJsonObject(generation.templateData);
  const model = normalizeModel(generation.model, params);
  const billingModule = inferModule(generation.type);
  const provider = String(generation.externalProvider || params?.provider || "").trim() || null;
  const providerModel = String(params?.providerModel || params?.model || model || "").trim() || null;
  const occurredAt = generation.createdAt || new Date();
  const unit = inferUnit({ type: generation.type, status: generation.status, params });
  const pricingContext = buildPricingContext({ type: generation.type, params, unit });
  if(billingModule === "image" && unit.billable && ((provider === "apimart" && APIMART_QUOTES[model]) || (provider === "google-ai-studio" && GOOGLE_IMAGE_QUOTES[model]) || (provider === "tuzi" && TUZI_IMAGE_QUOTES[model]))) {
    const mediaRules = await db.billingPriceRule.findMany({where:{provider,model,isActive:true},orderBy:[{effectiveFrom:"desc"},{id:"desc"}]});
    if(mediaRules.some((r:any)=>r.unitType.endsWith("_million_token"))) return recordMediaTokenCost({...generation,model},params,pricingContext,mediaRules,db);
  }
  const priceRule = unit.billable
    ? await findActivePriceRule({ provider, model, providerModel, module: billingModule, occurredAt, context: pricingContext }, db)
    : null;
  const effectiveUnitType = priceRule?.unitType || unit.unitType;
  const officialMiniMaxH3 = provider === MINIMAX_PROVIDER_ID && model === MINIMAX_H3_MODEL_ID;
  const seedreamPro = provider === "volcengine" && model === "doubao-seedream-5.0-pro";
  const seedream55 = (provider === "apimart" && model === APIMART_SEEDREAM_55_MODEL) || (provider === "volcengine" && model === VOLC_SEEDREAM_55_MODEL);
  const qwenImage = provider === "bailian" && model === "qwen-image-3.0";
  const officialMiniMaxVideo = officialMiniMaxH3
    || (provider === MINIMAX_PROVIDER_ID && model === MINIMAX_H3_MAX_MODEL_ID);
  const providerUsage = params?.providerUsage || params?.usage || {};
  const reportedOutputSeconds = Number(providerUsage.output_seconds);
  const ruleUnitCount = priceRule ? unitCountForRule(effectiveUnitType, params, unit.unitCount) : unit.unitCount;
  const apimartVideoInput = provider === "apimart" && billingModule === "video" && pricingContext.inputContainsVideo === "true" && effectiveUnitType === "second";
  const inputSeconds = Number(providerUsage.input_video_duration ?? providerUsage.input_seconds ?? params?.referenceVideoDuration);
  const effectiveUnitCount = apimartVideoInput ? (Number.isFinite(inputSeconds) && inputSeconds > 0 ? ruleUnitCount + inputSeconds : 0) : officialMiniMaxVideo
    && effectiveUnitType === "second"
    && Number.isFinite(reportedOutputSeconds)
    && reportedOutputSeconds > 0
      ? reportedOutputSeconds
      : ruleUnitCount;
  const unitPrice = priceRule ? decimalNumber(priceRule.unitPrice) : 0;
  const reportedInputSeconds = Number(providerUsage.input_seconds);
  const inputVideoSeconds = officialMiniMaxH3 && Number.isFinite(reportedInputSeconds) && reportedInputSeconds > 0
    ? reportedInputSeconds
    : 0;
  const fallbackImageCount = Number(pricingContext.referenceImageCount || 0);
  const reportedImageCount = Number(providerUsage.input_image_count);
  const qwenInputImages = params?.bailianQwenImage?.request?.input?.messages?.flatMap((message: any) => message.content || []).filter((part: any) => typeof part.image === "string").length;
  const inputImageCount = seedream55 ? Number(params?.imageInputCount ?? params?.apimart?.request?.image_urls?.length ?? 0) : qwenImage ? Number(qwenInputImages ?? params?.imageInputCount ?? fallbackImageCount) : seedreamPro ? Number(params?.seedream?.imageInputCount ?? fallbackImageCount) : officialMiniMaxH3 && Number.isFinite(reportedImageCount) && reportedImageCount >= 0
    ? reportedImageCount
    : fallbackImageCount;
  const billableImageCount = (qwenImage || seedream55) ? inputImageCount : seedreamPro ? Math.max(0, inputImageCount - 1) : officialMiniMaxH3
    ? Math.max(0, inputImageCount - MINIMAX_H3_FREE_IMAGE_COUNT)
    : 0;
  const additionalRules = (officialMiniMaxH3 || seedreamPro || qwenImage || seedream55) && priceRule ? (await db.billingPriceRule.findMany({ where: { provider, model, isActive: true, unitType: { in: (qwenImage || seedream55) ? ["input_image"] : seedreamPro ? ["additional_input_image"] : ["input_second", "excess_image"] }, effectiveFrom: { lte: occurredAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: occurredAt } }] }, orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }] })).filter((r: any) => conditionMatches(r, pricingContext)) : [];
  const inputRule = additionalRules.find((r: any) => r.unitType === "input_second");
  const imageRule = additionalRules.find((r: any) => r.unitType === ((qwenImage || seedream55) ? "input_image" : seedreamPro ? "additional_input_image" : "excess_image"));
  const inputUnitPrice = inputRule ? decimalNumber(inputRule.unitPrice) : unitPrice;
  const excessImagePrice = imageRule ? decimalNumber(imageRule.unitPrice) : (seedreamPro || qwenImage || seedream55) ? 0 : MINIMAX_H3_EXCESS_IMAGE_PRICE;
  const additionalCurrencyValid = (!(seedreamPro || qwenImage || seedream55) || !!imageRule) && (!inputRule || inputRule.currency === priceRule?.currency) && (!imageRule || imageRule.currency === priceRule?.currency);
  const inputVideoAmount = unit.billable && priceRule && officialMiniMaxH3
    ? roundedAmount(inputVideoSeconds * inputUnitPrice)
    : 0;
  const imageAmount = unit.billable && priceRule && (officialMiniMaxH3 || seedreamPro || qwenImage || seedream55)
    ? roundedAmount(billableImageCount * excessImagePrice)
    : 0;
  const additiveCharges = inputVideoAmount > 0 || imageAmount > 0
    ? {
        inputVideoSeconds,
        inputVideoUnitPrice: inputUnitPrice,
        inputVideoAmount,
        inputImageCount,
        freeImageCount: (qwenImage || seedream55) ? 0 : seedreamPro ? 1 : MINIMAX_H3_FREE_IMAGE_COUNT,
        billableImageCount,
        imageUnitPrice: excessImagePrice,
        ...(inputRule ? { inputRuleId: inputRule.id } : {}),
        ...(imageRule ? { imageRuleId: imageRule.id } : {}),
        imageAmount,
      }
    : null;
  const amount = unit.billable && priceRule
    ? roundedAmount(effectiveUnitCount * unitPrice + inputVideoAmount + imageAmount)
    : 0;
  const rate = !priceRule || priceRule.currency === "CNY"
    ? { id: "CNY", rate: "1", effectiveFrom: null }
    : resolveExchangeRate((await readBillingSettings(db)).rates, provider || "", priceRule.currency, occurredAt);
  const originalAmount = decimal(effectiveUnitCount).mul(unitPrice).add(inputVideoAmount).add(imageAmount).toFixed(8);
  const conversion = { version: 1, originalAmount, originalCurrency: priceRule?.currency || "CNY", amountCny: convertToCny(originalAmount, rate), rate: rate?.rate || null, rateId: rate?.id || null, effectiveFrom: rate?.effectiveFrom || null };
  const costStatus = unit.billable
    ? priceRule && additionalCurrencyValid
      ? unitPrice > 0 && effectiveUnitCount <= 0 && !(provider === "openrouter" && effectiveUnitType === "provider_usd" && providerUsage?.usage?.cost === 0)
        ? "missing_usage"
        : !rate ? "missing_rate" : "priced"
      : "unpriced"
    : unit.costStatus;

  // Older APIMART video responses saved actual debited credits but omitted input duration.
  // Use the same historically configured credit conversion as image reconciliation.
  const reportedCredits = providerUsage.credits_cost;
  const creditRate = provider === "apimart" && billingModule === "video" && costStatus === "missing_usage"
    && model !== APIMART_SEEDANCE_25_MODEL_ID
    && typeof reportedCredits === "number" && Number.isFinite(reportedCredits) && reportedCredits >= 0
    ? resolveExchangeRate((await readBillingSettings(db)).rates, provider, "CREDIT", occurredAt)
    : null;
  const creditFallback = creditRate && decimal(creditRate.rate).gt(0)
    ? { credits: decimal(reportedCredits).toDecimalPlaces(8).toString(), rate: creditRate }
    : null;
  const creditAmount = creditFallback ? decimal(creditFallback.credits).mul(creditFallback.rate.rate).toFixed(8) : null;
  const creditSnapshot = creditFallback ? {
    basis: "provider_reported_credits",
    reportedCredits: creditFallback.credits,
    creditConversion: { ...creditFallback.rate },
    conversion: { version: 1, originalAmount: creditAmount, originalCurrency: "CNY", amountCny: creditAmount, rate: "1", rateId: "CNY", effectiveFrom: null },
  } : null;

  try {
    return await db.usageLedger.upsert({
    where: { generationId: generation.id },
    create: {
      userId: String(generation.userId || ""),
      authUserId: generation.authUserId ?? null,
      username: generation.authUser?.username || null,
      module: billingModule,
      source: String(generation.source || "tool"),
      generationId: generation.id,
      requestKey: generation.requestKey || null,
      externalProvider: provider,
      externalTaskId: generation.externalTaskId || null,
      model,
      providerModel,
      status: String(generation.status || ""),
      billable: unit.billable,
      unitType: creditFallback ? "credit" : effectiveUnitType,
      unitCount: asDecimal(creditFallback?.credits ?? effectiveUnitCount),
      unitPrice: asDecimal(creditFallback?.rate.rate ?? unitPrice),
      amount: asDecimal(creditAmount ?? amount),
      currency: creditFallback ? "CNY" : priceRule?.currency || "CNY",
      costStatus: creditFallback ? "priced" : costStatus,
      pricingSnapshot: priceRule
        ? {
            conversion,
            ruleId: priceRule.id,
            provider: priceRule.provider,
            model: priceRule.model,
            unitType: priceRule.unitType,
            unitPrice: decimalNumber(priceRule.unitPrice),
            currency: priceRule.currency,
            matchConditions: priceRule.matchConditions || null,
            priority: priceRule.priority,
            effectiveFrom: priceRule.effectiveFrom?.toISOString?.() || null,
            effectiveTo: priceRule.effectiveTo?.toISOString?.() || null,
            ...(additiveCharges ? { additiveCharges } : {}),
            ...(creditSnapshot || {}),
          }
        : null,
      requestSnapshot: {
        type: generation.type,
        prompt: generation.prompt,
        params,
        errorMsg: generation.errorMsg,
      },
      usageSnapshot: {
        generationId: generation.id,
        externalTaskId: generation.externalTaskId,
        unitType: effectiveUnitType,
        unitCount: effectiveUnitCount,
        pricingContext,
        ...(params?.providerUsage ? { providerUsage } : {}),
      },
      occurredAt,
      finishedAt: generation.finishedAt || null,
    } as any,
    update: {
      userId: String(generation.userId || ""),
      authUserId: generation.authUserId ?? null,
      username: generation.authUser?.username || null,
      module: billingModule,
      source: String(generation.source || "tool"),
      requestKey: generation.requestKey || null,
      externalProvider: provider,
      externalTaskId: generation.externalTaskId || null,
      model,
      providerModel,
      status: String(generation.status || ""),
      billable: unit.billable,
      unitType: creditFallback ? "credit" : effectiveUnitType,
      unitCount: asDecimal(creditFallback?.credits ?? effectiveUnitCount),
      unitPrice: asDecimal(creditFallback?.rate.rate ?? unitPrice),
      amount: asDecimal(creditAmount ?? amount),
      currency: creditFallback ? "CNY" : priceRule?.currency || "CNY",
      costStatus: creditFallback ? "priced" : costStatus,
      pricingSnapshot: priceRule
        ? {
            conversion,
            ruleId: priceRule.id,
            provider: priceRule.provider,
            model: priceRule.model,
            unitType: priceRule.unitType,
            unitPrice: decimalNumber(priceRule.unitPrice),
            currency: priceRule.currency,
            matchConditions: priceRule.matchConditions || null,
            priority: priceRule.priority,
            effectiveFrom: priceRule.effectiveFrom?.toISOString?.() || null,
            effectiveTo: priceRule.effectiveTo?.toISOString?.() || null,
            ...(additiveCharges ? { additiveCharges } : {}),
            ...(creditSnapshot || {}),
          }
        : null,
      requestSnapshot: {
        type: generation.type,
        prompt: generation.prompt,
        params,
        errorMsg: generation.errorMsg,
      },
      usageSnapshot: {
        generationId: generation.id,
        externalTaskId: generation.externalTaskId,
        unitType: effectiveUnitType,
        unitCount: effectiveUnitCount,
        pricingContext,
        ...(params?.providerUsage ? { providerUsage } : {}),
      },
      occurredAt,
      finishedAt: generation.finishedAt || null,
    } as any,
    });
  } catch (error) {
    const requestKey = String(generation.requestKey || "").trim();
    if (!requestKey || !isUsageLedgerRequestKeyConflict(error)) throw error;
    const existing = await db.usageLedger.findUnique({ where: { requestKey } });
    if (!existing) throw error;
    return existing;
  }
}

export async function backfillUsageLedgersForGenerations(where: Record<string, any>, limit = 500) {
  const rows = await prisma.generation.findMany({
    where: { ...where, type: { not: "import" } } as any,
    include: { authUser: { select: { username: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(2000, limit)),
  });
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await upsertUsageLedgerForGeneration(row as any);
      synced += 1;
    } catch (error) {
      failed += 1;
      console.error("[billing-ledger] backfill failed", { generationId: row.id, error });
    }
  }
  return { scanned: rows.length, synced, failed };
}
