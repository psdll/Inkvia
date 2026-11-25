import {
  GPT_IMAGE_2_OFFICIAL_4K_RATIOS,
  GPT_IMAGE_2_OFFICIAL_QUALITIES,
  GPT_IMAGE_2_OFFICIAL_RATIOS,
  REAPI_GPT_IMAGE_2_MODEL_ID,
} from "./gpt-image-2-official";

const USD_TO_CNY = 7.2;

type PriceRule = {
  provider: "reapi" | "aicoming";
  model: string;
  displayName: string;
  module: "image";
  unitType: "image";
  unitPrice: number;
  currency: "CNY";
  priority: number;
  matchConditions: Record<string, string>;
  notes: string;
};

type QualityPrices = Record<"low" | "medium" | "high", Record<string, number>>;

function symmetricPrices(groups: Array<[readonly string[], number]>) {
  return Object.fromEntries(groups.flatMap(([ratios, price]) => ratios.map((ratio) => [ratio, price])));
}

const REAPI_USD_PRICES: Record<"1K" | "2K" | "4K", QualityPrices> = {
  "1K": {
    low: symmetricPrices([
      [["3:4"], 0.02],
      [GPT_IMAGE_2_OFFICIAL_RATIOS.filter((ratio) => ratio !== "3:4"), 0.022],
    ]),
    medium: symmetricPrices([
      [["3:4", "4:3"], 0.032],
      [["1:1"], 0.0424],
      [["4:5", "5:4"], 0.0528],
      [["16:9", "9:16"], 0.0536],
      [["2:3", "3:2"], 0.0632],
      [["21:9", "9:21"], 0.0704],
      [["1:2", "2:1"], 0.0848],
    ]),
    high: symmetricPrices([
      [["3:4", "4:3"], 0.1272],
      [["1:1"], 0.1688],
      [["4:5", "5:4"], 0.2104],
      [["16:9", "9:16"], 0.2136],
      [["2:3", "3:2"], 0.252],
      [["21:9", "9:21"], 0.28],
      [["1:2", "2:1"], 0.3376],
    ]),
  },
  "2K": {
    low: symmetricPrices([
      [["1:1", "4:5", "5:4"], 0.02392],
      [GPT_IMAGE_2_OFFICIAL_RATIOS.filter((ratio) => !["1:1", "4:5", "5:4"].includes(ratio)), 0.022],
    ]),
    medium: symmetricPrices([
      [["16:9", "9:16"], 0.0952],
      [["2:3", "3:2"], 0.112],
      [["21:9", "9:21"], 0.1248],
      [["3:4", "4:3"], 0.1272],
      [["1:2", "2:1"], 0.1456],
      [["1:1"], 0.1688],
      [["4:5", "5:4"], 0.2112],
    ]),
    high: symmetricPrices([
      [["16:9", "9:16"], 0.3792],
      [["2:3", "3:2"], 0.4472],
      [["21:9", "9:21"], 0.4984],
      [["3:4", "4:3"], 0.5064],
      [["1:2", "2:1"], 0.58],
      [["1:1"], 0.6736],
      [["4:5", "5:4"], 0.7736],
    ]),
  },
  "4K": {
    low: symmetricPrices([
      [["21:9", "9:21"], 0.02896],
      [["1:2", "2:1"], 0.03368],
      [["16:9", "9:16"], 0.03792],
    ]),
    medium: symmetricPrices([
      [["21:9", "9:21"], 0.256],
      [["1:2", "2:1"], 0.2976],
      [["16:9", "9:16"], 0.3344],
    ]),
    high: symmetricPrices([
      [["21:9", "9:21"], 0.8336],
      [["1:2", "2:1"], 0.8936],
      [["16:9", "9:16"], 0.9536],
    ]),
  },
};

function cny(usd: number) {
  return Number((usd * USD_TO_CNY).toFixed(8));
}

export const REAPI_GPT_IMAGE_2_PRICE_RULES: PriceRule[] = (
  Object.entries(REAPI_USD_PRICES) as Array<["1K" | "2K" | "4K", QualityPrices]>
).flatMap(([resolution, qualityPrices]) => {
  const ratios = resolution === "4K" ? GPT_IMAGE_2_OFFICIAL_4K_RATIOS : GPT_IMAGE_2_OFFICIAL_RATIOS;
  return GPT_IMAGE_2_OFFICIAL_QUALITIES.flatMap((quality) => {
    const prices = qualityPrices[quality];
    const autoPrice = Math.max(...ratios.map((ratio) => prices[ratio]));
    return [...ratios, "auto"].map((aspectRatio) => ({
      provider: "reapi" as const,
      model: REAPI_GPT_IMAGE_2_MODEL_ID,
      displayName: "GPT-Image-2（re）",
      module: "image" as const,
      unitType: "image" as const,
      unitPrice: cny(aspectRatio === "auto" ? autoPrice : prices[aspectRatio]),
      currency: "CNY" as const,
      priority: 60,
      matchConditions: { resolution, quality, aspectRatio },
      notes: "reAPI 2026-08-14 静态美元价格快照；固定汇率 1 USD = 7.20 CNY；auto 按同档最高价",
    }));
  });
});

export const GPT_IMAGE_2_OFFICIAL_DEFAULT_PRICE_RULES: PriceRule[] = [
  ...REAPI_GPT_IMAGE_2_PRICE_RULES,
];
