// Standard generateContent USD / million tokens, verified 2026-09-22.
// https://ai.google.dev/gemini-api/docs/pricing
export const GOOGLE_IMAGE_QUOTES = Object.fromEntries(Object.entries({
  "gemini-3.1-flash-image": ["0.5", "3", "60"],
  "gemini-3.1-flash-lite-image": ["0.25", "1.5", "30"],
  "gemini-3-pro-image": ["2", "12", "120"],
  // Nano Banana 2.1 standard tariffs verified 2026-10-09.
  "gemini-nano-banana-2.1": ["1.5", "7.5", "30"],
}).map(([model, prices]) => [model, ["input_million_token", "text_output_million_token", "image_output_million_token"].map((unitType, i) => ({ unitType, conditions: {}, usd: prices[i] }))]));

export function googleImageTokenCounts(u: any) {
  const valid = (n: any) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!u || !valid(u.promptTokenCount) || !valid(u.candidatesTokenCount) || !valid(u.thoughtsTokenCount ?? 0) || (u.cachedContentTokenCount ?? 0) !== 0) return null;
  const details = u.candidatesTokensDetails;
  if (!Array.isArray(details) || !details.length || details.some((d: any) => !valid(d.tokenCount) || !["IMAGE", "TEXT"].includes(d.modality))) return null;
  const detailedCount = details.reduce((s: number, d: any) => s + d.tokenCount, 0);
  // IMAGE-only details can omit text tokens while candidatesTokenCount includes them.
  // This image endpoint requests TEXT + IMAGE, so the residual is text, not more images.
  // An explicit TEXT breakdown must still reconcile exactly.
  if (detailedCount > u.candidatesTokenCount ||
    (details.some((d: any) => d.modality === "TEXT") && detailedCount !== u.candidatesTokenCount)) return null;
  if (u.totalTokenCount != null && (!valid(u.totalTokenCount) ||
    u.totalTokenCount !== u.promptTokenCount + u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0))) return null;
  const images = details.filter((d: any) => d.modality === "IMAGE").reduce((s: number, d: any) => s + d.tokenCount, 0);
  return { input_million_token: u.promptTokenCount, text_output_million_token: u.candidatesTokenCount - images + (u.thoughtsTokenCount ?? 0), image_output_million_token: images };
}
