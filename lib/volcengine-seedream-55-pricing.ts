import { VOLC_SEEDREAM_55_MODEL } from "./volcengine-seedream-55";
// Verified 2026-11-13: https://docs.volcengine.com/docs/ark/model-pricing?lang=zh
export const VOLC_SEEDREAM_55_PRICE_RULES = [
  { unitType: "image", unitPrice: 0.13, matchConditions: { seedream55PixelTier: "low" } },
  { unitType: "image", unitPrice: 0.23, matchConditions: { seedream55PixelTier: "high" } },
  { unitType: "input_image", unitPrice: 0.05, matchConditions: {} },
].map(rule => ({ ...rule, provider: "volcengine", model: VOLC_SEEDREAM_55_MODEL, module: "image", currency: "CNY", priority: 50,
  notes: "火山引擎官方原价：每张实际输出 ≤2610000 像素 0.13 元，>2610000 像素 0.23 元；每张输入 0.05 元，无免费首张；拆分按每张输出计费。核对：2026-11-13；https://docs.volcengine.com/docs/ark/model-pricing?lang=zh" }));
