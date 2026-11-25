// User screenshots, 2026-09-22. USD quotes × 7 CNY/USD; never active defaults.
type Quote = { unitType: string; price: string; conditions: Record<string, string> };
const rows = (input: string, output: string, cached: string, conditions: Record<string, string> = {}): Quote[] =>
  Object.entries({ input_million_token: input, output_million_token: output,
    cached_million_token: cached, cache_creation_million_token: "" })
    .map(([unitType, price]) => ({ unitType, price, conditions }));
export const EASYROUTER_QUOTES: Record<string, Quote[]> = {
  "gpt-5.5": [
    ...rows("35", "210", "3.5", { inputBand: "up_to_272000" }),
    ...rows("70", "315", "7", { inputBand: "over_272000" }),
  ],
  "gemini-3-flash-preview": rows("3.5", "21", "0.35"),
};
