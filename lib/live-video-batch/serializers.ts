export function toLiveVideoBatchJson<T>(value: T): T {
  if (typeof value === "bigint") return String(value) as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) return value.map(toLiveVideoBatchJson) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toLiveVideoBatchJson(item)]),
    ) as T;
  }
  return value;
}
