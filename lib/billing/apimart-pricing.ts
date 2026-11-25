import { APIMART_SEEDREAM_55_MODEL } from "@/lib/apimart-seedream-55";
import { SUNO_MODELS } from "@/lib/suno-models";
import { APIMART_GPT_IMAGE_26_MODEL_ID, APIMART_GPT_IMAGE_26_UPSTREAM_MODELS } from "@/lib/apimart-image-models";
// APIMART 官方价 column inspected 2026-09-30; excludes membership/off-peak discounts.
// Quotes prepare drafts and describe billing slots; they never activate prices by themselves.
export const APIMART_QUOTE_DATE = "2026-09-30";
export const APIMART_QUOTE_SOURCE = "https://apimart.ai/zh/pricing";
export const APIMART_SEEDANCE_25_QUOTE_DATE = "2026-10-01";
export const APIMART_SEEDANCE_25_QUOTE_SOURCE = "https://apimart.ai/zh/model/doubao-seedance-2-5";
export const APIMART_GPT_IMAGE_26_QUOTE_DATE = "2026-11-05";
export const APIMART_GPT_IMAGE_26_QUOTE_SOURCE = "https://apimart.ai/zh/model/gpt-image-2-6-flare / https://apimart.ai/zh/model/gpt-image-2-6-sunburst";
export const MEDIA_TOKEN_LABELS: Record<string, string> = {
  text_input_million_token: "每百万文本输入 token",
  cached_text_input_million_token: "每百万缓存文本输入 token",
  image_input_million_token: "每百万图片输入 token",
  cached_image_input_million_token: "每百万缓存图片输入 token",
  text_output_million_token: "每百万文本输出 token",
  image_output_million_token: "每百万图片输出 token",
};
type Quote = {
  unitType: string;
  credits: string;
  conditions: Record<string, string>;
};
const rows = (
  values: Record<string, string>,
  conditions: Record<string, string> = {},
): Quote[] =>
  Object.entries(values).map(([unitType, credits]) => ({
    unitType,
    credits,
    conditions,
  }));
const image = rows({
  text_input_million_token: "50",
  cached_text_input_million_token: "12.5",
  image_input_million_token: "80",
  cached_image_input_million_token: "20",
  image_output_million_token: "300",
});
const bands = (
  normal: Record<string, string>,
  long: Record<string, string>,
) => [
  ...rows(normal, { inputBand: "up_to_272000" }),
  ...rows(long, { inputBand: "over_272000" }),
];
const video = (values: Record<string, [string, string]>) =>
  Object.entries(values).flatMap(([resolution, [output, input]]) => [
    ...rows({ second: output }, { resolution, inputContainsVideo: "false" }),
    ...rows({ second: input }, { resolution, inputContainsVideo: "true" }),
  ]);
export const APIMART_QUOTES: Record<string, Quote[]> = {
  [APIMART_SEEDREAM_55_MODEL]: [
    ...rows({ image: "0.2" }, { seedream55PixelTier: "low" }),
    ...rows({ image: "0.35" }, { seedream55PixelTier: "high" }),
    ...rows({ input_image: "0.08" }),
  ],
  ...Object.fromEntries(SUNO_MODELS.map(m => [m.id, [
    ...rows({ request: "0.625" }, { maxMode: "false" }),
    ...rows({ request: "1.25" }, { maxMode: "true" }),
  ]])),
  // 2026-10-13 official USD rates x 10 credits/USD (not membership effective_rates).
  "gemini-nano-banana-2.1-apimart": rows({ text_input_million_token: "15", image_input_million_token: "15", text_output_million_token: "75", image_output_million_token: "300" }),
  // Official Token 价格, not the per-second precharge estimates or membership prices.
  "seedance-2.5-apimart": Object.entries({
    "480p": ["125", "75"],
    "720p": ["125", "75"],
    "1080p": ["137.5", "82.1"],
  }).flatMap(([resolution, [output, input]]) => [
    ...rows({ million_token: output }, { resolution, inputContainsVideo: "false" }),
    ...rows({ million_token: input }, { resolution, inputContainsVideo: "true" }),
  ]),
  "midjourney-v8-apimart": [
    ...["imagine", "edits"].flatMap((midjourneyAction) =>
      Object.entries({ relax: midjourneyAction === "imagine" ? "0.563" : "0.688", fast: "0.688", turbo: "1.25" })
        .flatMap(([speed, price]) => rows({ request: price }, { speed, midjourneyAction }))),
  ],
  "gpt-image-2-apimart": image,
  "gpt-image-2.5-apimart": [
    ...image.map((r) => ({
      ...r,
      conditions: { providerModel: "gpt-image-2.5-flare" },
    })),
    ...image.map((r) => ({
      ...r,
      conditions: { providerModel: "gpt-image-2.5-sunburst" },
    })),
  ],
  // Both 2.6 preview pages publish the same standard rates, with settlement by actual usage.
  [APIMART_GPT_IMAGE_26_MODEL_ID]: Object.values(APIMART_GPT_IMAGE_26_UPSTREAM_MODELS).flatMap((providerModel) =>
    rows({
      text_input_million_token: "50",
      cached_text_input_million_token: "12.5",
      image_input_million_token: "80",
      cached_image_input_million_token: "20",
      image_output_million_token: "300",
    }, { providerModel })),
  "nano-banana-pro-apimart": rows({
    text_input_million_token: "20",
    image_input_million_token: "20",
    text_output_million_token: "120",
    image_output_million_token: "1200",
  }),
  "doubao-seedance-2.0-face": video({
    "480p": ["1.24", "0.75"],
    "720p": ["2.67", "1.61"],
    "1080p": ["6.25", "3.75"],
  }),
  "doubao-seedance-2.0-fast-face": video({
    "480p": ["1", "0.6"],
    "720p": ["2.15", "1.29"],
  }),
  "gpt-5.5": bands(
    {
      input_million_token: "50",
      cached_million_token: "5",
      output_million_token: "300",
    },
    {
      input_million_token: "100",
      cached_million_token: "10",
      output_million_token: "450",
    },
  ),
  "gpt-5.6-terra": bands(
    {
      input_million_token: "20",
      cached_million_token: "2",
      cache_creation_million_token: "25",
      output_million_token: "120",
    },
    {
      input_million_token: "40",
      cached_million_token: "4",
      cache_creation_million_token: "50",
      output_million_token: "180",
    },
  ),
  "qwen3.8-27b": rows({
    // Preserve the precision actually displayed by APIMART, without inferring hidden digits.
    input_million_token: "4.2857",
    cached_million_token: "0.8571",
    explicit_cached_million_token: "0.4286",
    cache_creation_million_token: "5.3571",
    output_million_token: "17.1429",
  }),
  "deepseek-v4.1-flash": [
    ...rows(
      {
        input_million_token: "2.8571",
        cached_million_token: "0.2857",
        output_million_token: "11.4286",
      },
      { timeBand: "peak" },
    ),
    ...rows(
      {
        // Same official price at night; the 50% off-peak discount is not list price.
        input_million_token: "2.8571",
        cached_million_token: "0.2857",
        output_million_token: "11.4286",
      },
      { timeBand: "off_peak" },
    ),
  ],
};
export function apimartContext(
  at: Date | string,
  inputTokens: number | null | undefined,
) {
  const hour = new Date(+new Date(at) + 8 * 3600000).getUTCHours();
  return {
    inputBand:
      inputTokens == null
        ? undefined
        : inputTokens > 272000
          ? "over_272000"
          : "up_to_272000",
    timeBand: hour >= 8 && hour < 22 ? "peak" : "off_peak",
  };
}
export function tariffLabel(c: Record<string, unknown>, unitType?: string) {
  return Object.entries(c)
    .map(([k, v]) =>
      k === "seedream55PixelTier" ? v === "low" ? "输出 ≤261 万像素" : "输出 >261 万像素"
        : k === "midjourneyAction"
        ? v === "edits" ? "参考图编辑" : "普通生成"
        : k === "deepseekTimeBand"
        ? v === "peak" ? "高峰（北京时间工作日 09–12、14–18，节假日除外）" : "空闲（其余时段、周末及节假日）"
        : k === "maxMode" ? v === "true" ? "Max 模式" : "普通模式"
        : k === "minimaxInputBand"
        ? v === "over_512000" ? "输入超过 512000 token" : "输入不超过 512000 token"
        : k === "inputBand"
        ? v === "over_272000"
          ? "输入超过 272000 token"
          : "输入不超过 272000 token"
        : k === "timeBand"
          ? v === "peak"
            ? "北京时间 08:00–22:00"
            : "北京时间 22:00–次日08:00"
          : k === "inputContainsVideo"
            ? v === "true"
              ? unitType === "million_token" ? "有参考视频" : "有参考视频（输入+输出总秒数）"
              : "无参考视频"
            : String(v),
    )
    .join(" / ");
}
