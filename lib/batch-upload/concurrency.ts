export const BATCH_UPLOAD_CONCURRENCY = 5;
export const BATCH_UPLOAD_MAX_FILES_PER_REQUEST = 5;

export function chunkBatchUploadFiles<T>(
  values: readonly T[],
  requestedSize = BATCH_UPLOAD_MAX_FILES_PER_REQUEST,
): T[][] {
  const size = Math.max(1, Math.floor(requestedSize) || 1);
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  requestedConcurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!values.length) return [];

  const concurrency = Math.max(
    1,
    Math.min(values.length, Math.floor(requestedConcurrency) || 1),
  );
  const results = new Array<R>(values.length);
  let cursor = 0;
  const errors: Array<{ index: number; error: unknown }> = [];

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      try {
        results[index] = await mapper(values[index], index);
      } catch (error) {
        errors.push({ index, error });
      }
    }
  });

  await Promise.all(workers);
  if (errors.length) {
    errors.sort((left, right) => left.index - right.index);
    const failures = errors.map(({ error }) => (
      error instanceof Error ? error.message : String(error || "上传失败")
    ));
    throw new AggregateError(
      errors.map(({ error }) => error),
      `以下文件上传失败：\n${failures.map((message) => `- ${message}`).join("\n")}`,
    );
  }
  return results;
}
