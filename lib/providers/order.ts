// Current admin baseline. Future platform IDs follow this list in their saved creation order.
export const ADMIN_PROVIDER_ORDER = [
  "kie", "apimart", "reapi", "aicoming-haiya", "tuzi",
  "volcengine", "volcengine-mediakit", "google-ai-studio", "bailian", "work-fisher", "openrouter",
  "minimax", "volcengine-speech", "deepseek", "bigmodel", "jiekou",
] as const;

export function sortAdminProviders<T extends { id: string; sortOrder?: number }>(providers: readonly T[]): T[] {
  const rank = new Map<string, number>(ADMIN_PROVIDER_ORDER.map((id, index) => [id, index]));
  return [...providers].sort((a, b) =>
    (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
      || (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER));
}
