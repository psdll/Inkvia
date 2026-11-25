import { APIMART_SEEDREAM_55_MODEL } from "./apimart-seedream-55";
// Original list prices, not membership prices. Verified 2026-11-10:
// https://apimart.ai/api/pricing/model?model=seedream-5-5
export const SEEDREAM_55_PRICE_RULES = [
  { unitType: "image", unitPrice: 0.14, matchConditions: { seedream55PixelTier: "low" } },
  { unitType: "image", unitPrice: 0.245, matchConditions: { seedream55PixelTier: "high" } },
  { unitType: "input_image", unitPrice: 0.056, matchConditions: {} },
].map(rule => ({ ...rule, provider: "apimart", model: APIMART_SEEDREAM_55_MODEL, module: "image", currency: "CNY", priority: 50,
  notes: "APIMart 官方原价 0.2/0.35 Credits 输出、0.08 Credits 输入；沿用项目已确认 1 Credit=0.70 元；输出按每张实际像素分档（≤2610000 / >2610000），拆分同价；参考图每张收费、无免费首张。核对：2026-11-10；https://apimart.ai/api/pricing/model?model=seedream-5-5" }));
