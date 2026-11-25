// Official USD / million tokens, checked 2026-09-30. Reference tariffs only:
// generation settlement continues to use Images API usage.cost via provider_usd.
// OpenAI: https://openrouter.ai/api/v1/images/models/{upstreamModelId}/endpoints
// Gemini text/image breakdown: https://openrouter.ai/google/gemini-3-pro-image
export const OPENROUTER_QUOTE_DATE = "2026-09-30";
const rows = (prices: Record<string, string>) => Object.entries(prices).map(([unitType, usd]) => ({ unitType, usd, conditions: {} }));
const openai = rows({ text_input_million_token: "5", image_input_million_token: "8", image_output_million_token: "30" });
export const OPENROUTER_IMAGE_QUOTES: Record<string, ReturnType<typeof rows>> = {
  // Exact Images API endpoint pricing, 2026-10-13.
  "gemini-nano-banana-2.1-openrouter": rows({ image_output_million_token: "30" }),
  "gpt-image-2.5-sunburst-openrouter": openai,
  "gpt-image-2-openrouter": openai,
  "gpt-image-2.5-flare-openrouter": openai,
  // Exact Images API endpoint pricing, 2026-11-05.
  "gpt-image-2.6-flare-openrouter": openai,
  "gpt-image-2.6-sunburst-openrouter": openai,
  "gemini-3-pro-image-openrouter": rows({
    text_input_million_token: "2", image_input_million_token: "2",
    image_output_million_token: "120", text_output_million_token: "12",
  }),
};
