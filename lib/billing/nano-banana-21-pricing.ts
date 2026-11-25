import { KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_MODEL, OPENROUTER_NANO_BANANA_21_MODEL } from "@/lib/nano-banana-21-providers";

// Platform list prices checked 2026-10-13. User-authorized conversion: 1 USD = 7 CNY.
const tokenUsd = { text_input_million_token: 1.5, image_input_million_token: 1.5, text_output_million_token: 7.5, image_output_million_token: 30 };
export const NANO_BANANA_21_PRICE_RULES = [
  ...Object.entries({ "1K": 0.14, "2K": 0.21, "4K": 0.315 }).map(([resolution, unitPrice]) => ({
    provider: "kie", model: KIE_NANO_BANANA_21_MODEL, module: "image", currency: "CNY", unitType: "image", unitPrice, priority: 40, matchConditions: { resolution },
    notes: "2026-10-13 Kie 原价 $0.02/$0.03/$0.045 每张，1 USD = 7 CNY。https://kie.ai/nano-banana-2-1",
  })),
  ...Object.entries(tokenUsd).map(([unitType, usd]) => ({
    provider: "apimart", model: APIMART_NANO_BANANA_21_MODEL, module: "image", currency: "CNY", unitType, unitPrice: usd * 7, priority: 40, matchConditions: null,
    notes: `2026-10-13 APIMart 官方原价 $${usd}/百万 token × 7；不使用会员实扣金额，不按分辨率预估价结算。https://apimart.ai/zh/model/nano-banana-2-1`,
  })),
  { provider: "openrouter", model: OPENROUTER_NANO_BANANA_21_MODEL, module: "image", currency: "CNY", unitType: "image_output_million_token", unitPrice: 210, priority: 30, matchConditions: null,
    notes: "2026-10-13 Images API 图片输出原价 $30/百万 token × 7，仅供查价；费用由 usage.cost 结算，不重复累加。https://openrouter.ai/api/v1/images/models/google/gemini-nano-banana-2.1/endpoints" },
  { provider: "openrouter", model: OPENROUTER_NANO_BANANA_21_MODEL, module: "image", currency: "CNY", unitType: "provider_usd", unitPrice: 7, priority: 40, matchConditions: null,
    notes: "2026-10-13 Images API usage.cost 实际美元费用 × 7，以人民币结算；缺少费用时待核算。https://openrouter.ai/docs/guides/overview/multimodal/image-generation" },
];
