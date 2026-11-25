export function toImageBatchJson<T>(value: T): T {
  if (typeof value === "bigint") return String(value) as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) return value.map((item) => toImageBatchJson(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        toImageBatchJson(item),
      ]),
    ) as T;
  }
  return value;
}
