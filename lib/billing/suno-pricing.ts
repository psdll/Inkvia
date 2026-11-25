import { SUNO_MODELS } from "@/lib/suno-models";

// APIMart list-price column, 2026-10-19: 0.625 / 1.25 Credits per request.
// Existing project conversion: 1 Credit = 0.70 CNY. Membership discounts are not tariffs.
export const SUNO_PRICE_RULES = SUNO_MODELS.flatMap(({ id }) => [false, true].map(maxMode => ({
  provider: "apimart", model: id, module: "audio", currency: "CNY", unitType: "request",
  unitPrice: maxMode ? 0.875 : 0.4375, priority: 100, matchConditions: { maxMode: String(maxMode) },
  notes: "2026-10-19 APIMart 官方价：普通 0.625 Credits/次，Max 1.25 Credits/次；1 Credit=0.70 CNY。一轮所有音轨仅计费一次。https://apimart.ai/zh/model/suno",
})));
