// Historical accounting only; this platform has no registry, catalog or generation adapter.
// User screenshots, official group; 200.20 CNY buys 286 USD credit.
// Public status uses the same 0.7 CNY/USD display rate: no second conversion.
export const TUZI_IMAGE_QUOTES = {
  "gpt-image-2-tuzi": Object.entries({
    text_input_million_token: "35",
    cached_text_input_million_token: "8.75",
    image_input_million_token: "56",
    cached_image_input_million_token: "14",
    text_output_million_token: "210",
    image_output_million_token: "210",
  }).map(([unitType, cny]) => ({ unitType, cny, conditions: {} })),
} as Record<string, { unitType: string; cny: string; conditions: Record<string, string> }[]>;

export function normalizeTuziImageUsage(usage: any) {
  if (!usage || typeof usage !== "object") return usage;
  // Images API output_tokens counts generated image tokens when no modality split exists.
  return {
    ...usage,
    output_tokens_details: usage.output_tokens_details ?? {
      image_tokens: usage.output_tokens,
      text_tokens: 0,
    },
  };
}
