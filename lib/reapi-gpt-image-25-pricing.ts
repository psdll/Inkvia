import { REAPI_GPT_IMAGE_25_LABEL } from "@/lib/gpt-image-25-models";

// Standard-channel snapshot, 2026-09-09: Flare $0.01725, Sunburst $0.023.
// reAPI rounds each n=1 request up to whole $0.001 credits; keep the project's fixed 7.2 CNY/USD rate.
export const REAPI_GPT_IMAGE_25_PRICE_RULES = (["flare", "sunburst"] as const).map((mode) => ({
  provider: "reapi" as const,
  // Historical standard-channel prices must not follow the active official IDs.
  model: `gpt-image-2.5-${mode}`,
  displayName: `${REAPI_GPT_IMAGE_25_LABEL} · ${mode === "flare" ? "快速生成" : "精细编辑"}`,
  module: "image" as const,
  unitType: "image" as const,
  unitPrice: Number(((mode === "flare" ? 18 : 23) / 1000 * 7.2).toFixed(8)),
  currency: "CNY" as const,
  priority: 60,
  matchConditions: null,
  notes: "reAPI 2026-09-09 标准渠道，按张固定计费，与画质/尺寸/参考图数量无关；n=1 向上取整为 18/23 积分；1 积分=$0.001；固定汇率 7.2 CNY/USD",
}));
