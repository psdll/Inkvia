/** Display categories are independent of generation tools and media formats. */
export function normalizeInspirationCategory(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("分类名称无效");
  const category = value.trim();
  if (category.length > 40) throw new Error("分类名称最多 40 个字符");
  return category || null;
}
