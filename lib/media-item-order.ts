export function swapMediaItems<T>(items: T[], sourceIndex: number, targetIndex: number): T[] {
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)
    || sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0
    || sourceIndex >= items.length || targetIndex >= items.length) return items;
  const next = items.slice();
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}

export function insertMediaItem<T>(
  items: T[],
  sourceIndex: number,
  targetIndex: number,
  placement: "before" | "after",
): T[] {
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)
    || sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0
    || sourceIndex >= items.length || targetIndex >= items.length) return items;
  const insertionIndex = targetIndex + (placement === "after" ? 1 : 0)
    - (sourceIndex < targetIndex ? 1 : 0);
  if (insertionIndex === sourceIndex) return items;
  const next = items.slice();
  const [item] = next.splice(sourceIndex, 1);
  next.splice(insertionIndex, 0, item);
  return next;
}
