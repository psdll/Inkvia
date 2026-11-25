export const MAX_IMAGE_TASK_COUNT = 10;

export type ImageTaskBatchEntry<T> =
  | { batchIndex: number; value: T }
  | { batchIndex: number; error: unknown };

export function normalizeImageTaskCount(value: unknown) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_TASK_COUNT) {
    throw new Error(`数量必须在 1 到 ${MAX_IMAGE_TASK_COUNT} 之间`);
  }
  return count;
}

export async function runImageTaskBatch<T>(
  taskCount: unknown,
  createTask: (batchIndex: number) => Promise<T>,
): Promise<ImageTaskBatchEntry<T>[]> {
  const count = normalizeImageTaskCount(taskCount);
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, index) => createTask(index + 1)),
  );

  return settled.map((item, index) =>
    item.status === "fulfilled"
      ? { batchIndex: index + 1, value: item.value }
      : { batchIndex: index + 1, error: item.reason },
  );
}
