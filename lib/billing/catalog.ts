import { isSunoModel } from "@/lib/suno-models";
import { isBigModelGlm53 } from "@/lib/bigmodel-llm-models";
import { isDoubaoSeedEvolving } from "@/lib/volcengine-llm-models";
import { MEDIAKIT_PROVIDER, MEDIAKIT_SUBTITLE_MODEL, MEDIAKIT_SUBTITLE_LABEL } from "@/lib/volcengine-mediakit-models";
import prisma from "@/lib/prisma";
import { isMidjourneyV8Model } from "@/lib/midjourney-v8";
import { TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { sora2Models } from "@/lib/sora2";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { isRetiredProviderModel } from "@/lib/providers/retired-models";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { isSeedAudioModel } from "@/lib/seed-audio-models";
import {
  activeAt,
  conditionKey,
  matches,
  resolveExchangeRate,
  type BillingSettings,
} from "./money";
import { DEFAULT_PRICE_RULES } from "./default-prices";
import { MINIMAX_LLM_QUOTES } from "./minimax-pricing";
import { DEEPSEEK_QUOTES } from "./deepseek-pricing";
import { GOOGLE_IMAGE_QUOTES } from "./google-pricing";
import { TUZI_IMAGE_QUOTES } from "./tuzi-pricing";
import { OPENROUTER_IMAGE_QUOTES } from "./openrouter-pricing";
import {
  APIMART_QUOTES,
  MEDIA_TOKEN_LABELS,
  tariffLabel,
} from "./apimart-pricing";

export const UNIT_LABELS: Record<string, string> = {
  ...MEDIA_TOKEN_LABELS,
  provider_usd: "每美元上游实际费用",
  image: "每张",
  video: "每条视频",
  second: "每秒",
  minute: "每分钟",
  request: "每次",
  million_token: "每百万 token",
  ten_thousand_character: "每万字符",
  input_million_token: "每百万输入 token",
  output_million_token: "每百万输出 token",
  cached_million_token: "每百万缓存读取 token",
  explicit_cached_million_token: "每百万显式缓存输入 token",
  cache_creation_million_token: "每百万缓存写入 token",
};
UNIT_LABELS.input_second = "每秒输入视频";
UNIT_LABELS.excess_image = "每张超额参考图（前 5 张免费）";
UNIT_LABELS.additional_input_image = "每张参考图（首张免费）";
UNIT_LABELS.input_image = "每张输入参考图";
export type PriceSlot = {
  key: string;
  label: string;
  conditions: Record<string, unknown>;
  unitType: string;
  rule?: any;
  missing?: string;
};
export type BillingModel = {
  key: string;
  provider: string;
  providerName: string;
  providerSortOrder?: number;
  model: string;
  aliases?: string[];
  label: string;
  module: string;
  enabled: boolean;
  historical: boolean;
  slots: PriceSlot[];
  rules: any[];
  complete: boolean;
};

export function expandConditions(
  conditions: Record<string, unknown>,
): Record<string, unknown>[] {
  return Object.entries(conditions).reduce<Record<string, unknown>[]>(
    (rows, [key, values]) =>
      rows.flatMap((row) =>
        (Array.isArray(values) ? values : [values]).map((value) => ({
          ...row,
          [key]: value,
        })),
      ),
    [{}],
  );
}
const CONDITION_LABELS: Record<string, string> = {
  resolution: "分辨率",
  quality: "画质",
  speed: "速度",
  aspectRatio: "比例",
  duration: "时长",
  generateAudio: "生成音频",
  inputContainsVideo: "视频输入",
  inputContainsReferenceMedia: "参考素材",
  gptImage25Mode: "模式",
};
export function slotLabel(conditions: Record<string, unknown>) {
  return (
    Object.entries(conditions)
      .map(
        ([key, value]) =>
          key === "maxMode" ? (value === true || value === "true" ? "Max 模式" : "普通模式") : `${CONDITION_LABELS[key] || key} ${value === "true" || value === true ? "有" : value === "false" || value === false ? "无" : value}`,
      )
      .join(" / ") || "全部参数同价"
  );
}
export function chooseRule(rules: any[], slot: PriceSlot, at: Date) {
  return rules
    .filter(
      (r) =>
        activeAt(r, at) &&
        matches(r.matchConditions, slot.conditions) &&
        (slot.unitType.includes("_million_token") ||
        ["input_second", "excess_image", "additional_input_image", "input_image", "provider_usd"].includes(slot.unitType)
          ? r.unitType === slot.unitType
          : !["input_second", "excess_image", "additional_input_image", "input_image"].includes(r.unitType)),
    )
    .sort(
      (a, b) =>
        Number(b.priority) - Number(a.priority) ||
        Object.keys(b.matchConditions || {}).length -
          Object.keys(a.matchConditions || {}).length ||
        +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom) ||
        b.id - a.id,
    )[0];
}

export async function getBillingCatalog(
  settings: BillingSettings,
  at = new Date(),
  db: any = prisma,
  only?: { provider: string; model: string },
): Promise<BillingModel[]> {
  const [providers, rules] = await Promise.all([
    getRegisteredProviders(db),
    db.billingPriceRule.findMany({
      ...(only
        ? {
            where: {
              provider: only.provider,
              model: {
                in: [
                  only.model,
                  ...(TOOLBOX_MODEL_DEFINITIONS.find(
                    (m) => m.id === only.model && m.provider === only.provider,
                  )?.upstreamModelIds || []),
                  TOOLBOX_MODEL_DEFINITIONS.find(
                    (m) => m.id === only.model && m.provider === only.provider,
                  )?.upstreamModelId,
                ].filter(Boolean),
              },
            },
          }
        : {}),
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);
  const entries = new Map<string, any>();
  for (const m of TOOLBOX_MODEL_DEFINITIONS)
    entries.set(
      `${m.provider}|${m.id}`,
      {
        provider: m.provider,
        model: m.id,
        label: m.label,
        module: m.category,
        enabled: m.category !== "face" && isProviderModelEnabled(providers, m.category, m.id),
        historical: false,
      },
    );
  for (const p of providers)
    for (const [kind, ids] of Object.entries({
      chat: p.chatModels,
      image: p.imageModels,
      video: p.videoModels,
      audio: p.audioModels,
    })) {
      for (const id of ids || []) {
        const adapter = TOOLBOX_MODEL_DEFINITIONS.find(
          (m) =>
            m.provider === p.id &&
            (m.id === id ||
              m.upstreamModelId === id ||
              m.upstreamModelIds?.includes(id)),
        );
        if (adapter) continue;
        entries.set(`${p.id}|${id}`, {
          provider: p.id,
          model: id,
          label: p.id === MEDIAKIT_PROVIDER && id === MEDIAKIT_SUBTITLE_MODEL ? MEDIAKIT_SUBTITLE_LABEL : id,
          module: kind === "chat" ? "agent" : kind,
          enabled: p.enabled !== false && (kind === "chat" || (kind === "video" && p.id === MEDIAKIT_PROVIDER && id === MEDIAKIT_SUBTITLE_MODEL)),
          historical: false,
        });
      }
    }
  return Array.from(entries)
    // Old price rules and usage remain available for accounting, not model setup.
    .filter(([, entry]) => !isRetiredProviderModel(entry.provider, entry.model))
    .filter(
      ([, entry]) =>
        !only ||
        (entry.provider === only.provider && entry.model === only.model),
    )
    .map(([key, entry]) => {
      const definition = TOOLBOX_MODEL_DEFINITIONS.find(
        (m) => m.provider === entry.provider && m.id === entry.model,
      );
      const aliases = [
        ...new Set(
          [
            ...(definition?.upstreamModelIds || []),
            definition?.upstreamModelId,
          ].filter((m): m is string => !!m && m !== entry.model),
        ),
      ];
      const modelRules = rules
        .filter(
          (r: any) =>
            r.provider === entry.provider &&
            (r.model === entry.model || aliases.includes(r.model)),
        )
        .map((r: any) =>
          r.model === entry.model
            ? r
            : {
                ...r,
                matchConditions: {
                  ...(r.matchConditions || {}),
                  providerModel: r.model,
                },
              },
        );
      const video = sora2Models.find((m) => m.id === entry.model);
      const image =
        entry.module === "image" ? getImageModelParams(entry.model) : null;
      let unitType =
        entry.module === "image"
          ? "image"
          : entry.module === "audio"
            ? isSunoModel(entry.model) ? "request" : isSeedAudioModel(entry.model)
              ? "second"
              : "ten_thousand_character"
            : entry.module === "video"
              ? entry.provider === "volcengine"
                ? "million_token"
                : ["minimax", "bailian"].includes(entry.provider)
                  ? "second"
                  : "video"
              : "request";
      if (entry.provider === MEDIAKIT_PROVIDER && entry.model === MEDIAKIT_SUBTITLE_MODEL) unitType = "minute";
      const activeRules = modelRules.filter((r: any) => activeAt(r, at));
      unitType =
        activeRules.find(
          (r: any) => !["input_second", "excess_image", "additional_input_image", "input_image"].includes(r.unitType),
        )?.unitType || unitType;
      let conditions: Record<string, unknown>[] = [{}];
      if (image)
        conditions = expandConditions({
          resolution: image.resolutions.map((r) => r.value),
          ...(image.qualities.length > 1
            ? { quality: image.qualities.map((q) => q.value) }
            : {}),
        });
      if (aliases.length > 1)
        conditions = conditions.flatMap((c) =>
          aliases.map((providerModel) => ({ ...c, providerModel })),
        );
      if (isMidjourneyV8Model(entry.model)) {
        unitType = "request";
        conditions = ["relax", "fast", "turbo"].map(speed => ({ speed }));
      }
      if (video)
        conditions = expandConditions({
          resolution: video.supportedResolutions,
          ...(entry.model === "doubao-seedance-1-5-pro-251215"
            ? { generateAudio: ["true", "false"] }
            : {}),
          ...(unitType === "video"
            ? {
                duration:
                  video.durationOptions ||
                  Array.from(
                    {
                      length:
                        video.maxDurationSeconds - video.minDurationSeconds + 1,
                    },
                    (_, i) => i + video.minDurationSeconds,
                  ),
              }
            : {}),
          ...([
            "doubao-seedance-2-0-260128",
            "doubao-seedance-2-0-fast-260128",
            "doubao-seedance-2-0-mini-260615",
            "doubao-seedance-2-5-260628",
          ].includes(entry.model)
            ? { inputContainsVideo: ["true", "false"] }
            : {}),
          ...(entry.model === "doubao-seedance-2-5-260628"
            ? { inputContainsReferenceMedia: ["true", "false"] }
            : {}),
        });
      // Complete the real parameter space, not just the rows that happened to be priced.
      const extraAxes: Record<string, unknown[]> = {};
      const templates = DEFAULT_PRICE_RULES.filter(
        (r) => r.provider === entry.provider && r.model === entry.model,
      );
      for (const r of [...templates, ...activeRules])
        for (const [axis, value] of Object.entries(r.matchConditions || {})) {
          if (conditions.some((c) => axis in c)) continue;
          extraAxes[axis] ||= [];
          extraAxes[axis].push(...(Array.isArray(value) ? value : [value]));
        }
      for (const [axis, values] of Object.entries(extraAxes)) {
        conditions = conditions.flatMap((c) => {
          const actual =
            image && ["aspectRatio", "ratio"].includes(axis)
              ? getImageModelParams(entry.model, String(c.resolution || ""))
                  .aspectRatios.filter((r) => !r.disabled)
                  .map((r) => r.value)
              : [...new Set(values)];
          return actual.map((value) => ({ ...c, [axis]: value }));
        });
      }
      conditions = conditions.filter(
        (c) =>
          !(
            c.inputContainsVideo === "true" &&
            c.inputContainsReferenceMedia === "false"
          ),
      );
      conditions = [
        ...new Map(conditions.map((c) => [conditionKey(c), c])).values(),
      ];
      let slots: PriceSlot[] = conditions.map((c) => ({
        key: conditionKey(c),
        label: slotLabel(c),
        conditions: c,
        unitType,
      }));
      if (entry.provider === "volcengine" && entry.model === "doubao-seedream-5.0-pro")
        slots.push({ key: "additional_input_image", label: UNIT_LABELS.additional_input_image, conditions: {}, unitType: "additional_input_image" });
      if ((entry.provider === "bailian" && entry.model === "qwen-image-3.0") || (entry.provider === "volcengine" && entry.model === "doubao-seedream-5.5"))
        slots.push({ key: "input_image", label: UNIT_LABELS.input_image, conditions: {}, unitType: "input_image" });
      if (entry.module === "agent")
        slots = [
          "input_million_token",
          "output_million_token",
          "cached_million_token",
          "cache_creation_million_token",
        ].filter((unit) => !(((entry.provider === "bailian" && entry.model === "qwen3.8-omni-flash") || isDoubaoSeedEvolving(entry.provider, entry.model) || isBigModelGlm53(entry.provider, entry.model)) && unit === "cache_creation_million_token")).map((unit) => ({
          key: unit,
          label: UNIT_LABELS[unit],
          conditions: {},
          unitType: unit,
        }));
      if (entry.model === "minimax-h3" && entry.provider === "minimax") {
        slots.push(
          ...(video?.supportedResolutions || []).map((resolution) => ({
            key: `input:${resolution}`,
            label: `输入视频 ${resolution}`,
            conditions: { resolution },
            unitType: "input_second",
          })),
          {
            key: "excess_image",
            label: "超额参考图（前 5 张免费）",
            conditions: {},
            unitType: "excess_image",
          },
        );
      }
      if (entry.provider === "apimart" && APIMART_QUOTES[entry.model])
        slots = APIMART_QUOTES[entry.model].map((r) => ({
          key: `${r.unitType}|${conditionKey(r.conditions)}`,
          conditions: r.conditions,
          unitType: r.unitType,
          label: [tariffLabel(r.conditions, r.unitType), UNIT_LABELS[r.unitType]]
            .filter(Boolean)
            .join(" / "),
        }));
      if (entry.provider === "minimax" && MINIMAX_LLM_QUOTES[entry.model])
        slots = MINIMAX_LLM_QUOTES[entry.model].map((r) => ({
          key: `${r.unitType}|${conditionKey(r.conditions)}`,
          conditions: r.conditions,
          unitType: r.unitType,
          label: [tariffLabel(r.conditions), UNIT_LABELS[r.unitType]].filter(Boolean).join(" / "),
        }));
      if (entry.provider === "deepseek" && DEEPSEEK_QUOTES[entry.model])
        slots = DEEPSEEK_QUOTES[entry.model].map((r) => ({
          key: `${r.unitType}|${conditionKey(r.conditions)}`, conditions: r.conditions,
          unitType: r.unitType, label: `${tariffLabel(r.conditions)} / ${UNIT_LABELS[r.unitType]}`,
        }));
      if (entry.provider === "google-ai-studio" && GOOGLE_IMAGE_QUOTES[entry.model])
        slots = GOOGLE_IMAGE_QUOTES[entry.model].map((r) => ({
          key: r.unitType, conditions: {}, unitType: r.unitType,
          label: r.unitType === "input_million_token" ? "输入（文本和参考图）/ 每百万 token" : r.unitType === "text_output_million_token" ? "文本及思考输出 / 每百万 token" : "图片输出 / 每百万 token",
        }));
      if (entry.provider === "tuzi" && TUZI_IMAGE_QUOTES[entry.model])
        slots = TUZI_IMAGE_QUOTES[entry.model].map(r => ({
          key: r.unitType, conditions: {}, unitType: r.unitType, label: UNIT_LABELS[r.unitType],
        }));
      if (entry.provider === "openrouter") slots = [
        // Existing actual-cost configurations remain valid before reference tariffs are entered.
        ...(activeRules.some((r: { unitType: string }) => r.unitType.endsWith("_million_token")) ? OPENROUTER_IMAGE_QUOTES[entry.model] || [] : []).map(r => ({ key: r.unitType, conditions: {}, unitType: r.unitType, label: UNIT_LABELS[r.unitType] })),
        { key: "provider_usd", conditions: {}, unitType: "provider_usd", label: UNIT_LABELS.provider_usd },
      ];
      for (const slot of slots) {
        const rule = chooseRule(activeRules, slot, at);
        slot.rule = rule
          ? { ...rule, unitPrice: String(rule.unitPrice) }
          : null;
        slot.missing = !rule
          ? "缺价格"
          : !resolveExchangeRate(
                settings.rates,
                entry.provider,
                rule.currency,
                at,
              )
            ? "缺换算规则"
            : undefined;
      }
      return {
        ...entry,
        key,
        aliases,
        providerName:
          providers.find((p) => p.id === entry.provider)?.name ||
          entry.provider,
        providerSortOrder: providers.find((p) => p.id === entry.provider)?.sortOrder,
        slots,
        rules: modelRules.map((r: any) => ({
          ...r,
          unitPrice: String(r.unitPrice),
        })),
        complete: slots.length > 0 && slots.every((s) => !s.missing),
      };
    });
}
