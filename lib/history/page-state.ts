function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

export function mergePreferredById<T extends { id: string }>(preferred: T[], fallback: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...preferred, ...fallback]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export function replaceById<T extends { id: string }>(items: T[], incoming: T): T[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index < 0 || shallowEqual(items[index], incoming)) return items;
  const next = items.slice();
  next[index] = incoming;
  return next;
}

export type HistoryPageCache<T> = {
  items: T[];
  fetchedAt: number;
  nextCursor: string | null;
  hasMore?: boolean;
};

export function parseHistoryPageCache<T>(value: unknown): HistoryPageCache<T> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HistoryPageCache<T>>;
  if (!Array.isArray(candidate.items)) return null;
  return {
    items: candidate.items as T[],
    fetchedAt: Number(candidate.fetchedAt) || 0,
    nextCursor: typeof candidate.nextCursor === "string" ? candidate.nextCursor : null,
    hasMore: typeof candidate.hasMore === "boolean" ? candidate.hasMore : undefined,
  };
}

export function mergeHistoryFirstPage<T extends { id: string }>(firstPage: T[], cached: T[]): T[] {
  return mergePreferredById(firstPage, cached);
}

export function appendHistoryPage<T extends { id: string }>(current: T[], page: T[]): T[] {
  return mergePreferredById(current, page);
}
