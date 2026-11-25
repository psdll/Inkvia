import { MINIMAX_M3_MODEL_ID, MINIMAX_M31_FLASH_MODEL_ID } from "@/lib/minimax-llm-models";

// Standard pay-as-you-go list prices before the permanent 50% discount, per user pricing policy.
// Verified 2026-09-30: https://platform.minimax.cn/docs/guides/pricing-paygo
// The current MiniMax transport does not request priority service.
export const MINIMAX_M3_QUOTES = [
  ...["up_to_512000", "over_512000"].flatMap((minimaxInputBand) =>
    Object.entries(minimaxInputBand === "up_to_512000"
      ? { input_million_token: "4.2", output_million_token: "16.8", cached_million_token: "0.84" }
      : { input_million_token: "8.4", output_million_token: "33.6", cached_million_token: "1.68" }
    ).map(([unitType, price]) => ({ conditions: { minimaxInputBand }, unitType, price })),
  ),
];

// Flat standard-service CNY tariffs; no long-context tier or cache-write tariff.
// Verified 2026-10-21: https://platform.minimax.cn/docs/pricing/overview
export const MINIMAX_M31_FLASH_QUOTES = Object.entries({
  input_million_token: "1", output_million_token: "4", cached_million_token: "0.1",
}).map(([unitType, price]) => ({ conditions: {}, unitType, price }));

export const MINIMAX_LLM_QUOTES: Record<string, { conditions: Record<string, string>; unitType: string; price: string }[]> = {
  [MINIMAX_M3_MODEL_ID]: MINIMAX_M3_QUOTES,
  [MINIMAX_M31_FLASH_MODEL_ID]: MINIMAX_M31_FLASH_QUOTES,
};
