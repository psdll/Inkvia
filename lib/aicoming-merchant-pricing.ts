import {
  AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
  AICOMING_HAIYA_GPT_IMAGE_25_LABEL,
  AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS,
  AICOMING_HAIYA_PROVIDER_ID,
} from "@/lib/aicoming-merchant-models";

type PriceRule = {
  provider: "aicoming-haiya";
  model: string;
  displayName: string;
  module: "image" | "video";
  unitType: "image" | "second";
  unitPrice: number;
  currency: "CNY";
  priority: number;
  matchConditions: Record<string, string>;
  notes: string;
};

const HAIYA_PRICES = {
  "1K": 0.04,
  "2K": 0.05,
  "4K": 0.15,
} as const;

export const AICOMING_HAIYA_GPT_IMAGE_2_PRICE_RULES: PriceRule[] = Object.entries(HAIYA_PRICES).map(
  ([resolution, unitPrice]) => ({
    provider: AICOMING_HAIYA_PROVIDER_ID,
    model: AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
    displayName: "GPT-Image-2（hai）",
    module: "image",
    unitType: "image",
    unitPrice,
    currency: "CNY",
    priority: 50,
    matchConditions: { resolution },
    notes: "2026-10-12 海牙科技平台商户人民币单张参考报价；沿用原模型展示标识，实际调用须配置对应商户路由。",
  }),
);

// Exact model price_tiers from https://aicoming.top/api/v1/models?per_page=500, 2026-09-09.
const GPT_IMAGE_25_PRICES = { flare: [0.04, 0.06, 0.09], sunburst: [0.09, 0.12, 0.15] } as const;
export const AICOMING_HAIYA_GPT_IMAGE_25_PRICE_RULES: PriceRule[] = (["flare", "sunburst"] as const).flatMap((mode) =>
  ["1K", "2K", "4K"].map((resolution, index) => ({
    provider: AICOMING_HAIYA_PROVIDER_ID,
    model: AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS[mode],
    displayName: `${AICOMING_HAIYA_GPT_IMAGE_25_LABEL} · ${mode === "flare" ? "快速生成" : "精细编辑"}`,
    module: "image",
    unitType: "image",
    unitPrice: GPT_IMAGE_25_PRICES[mode][index],
    currency: "CNY",
    priority: 50,
    matchConditions: { resolution },
    notes: "海牙科技 2026-09-09 模型目录人民币单张价格快照，按真实上游模式和像素档位匹配",
  })),
);

export const AICOMING_MERCHANT_IMAGE_DEFAULT_PRICE_RULES: PriceRule[] = [
  ...AICOMING_HAIYA_GPT_IMAGE_2_PRICE_RULES,
  ...AICOMING_HAIYA_GPT_IMAGE_25_PRICE_RULES,
];

export const AICOMING_MERCHANT_DEFAULT_PRICE_RULES: PriceRule[] = [
  ...AICOMING_MERCHANT_IMAGE_DEFAULT_PRICE_RULES,
];
